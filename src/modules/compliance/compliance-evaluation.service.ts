import type { ComplianceSubjectType, PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  evaluateEvidence,
  isExemptionEffective,
  selectDriverLicenceAttachmentRepresentation,
  subjectComplianceSummary,
  type EvidenceCandidate,
} from "@/modules/compliance/compliance-evaluation";
import { daysUntilExpiry, statusForExpiry } from "@/modules/compliance/compliance-domain";
import { selectDriverLicence } from "@/modules/drivers/driver-licence-selector";

type TenantClient = Pick<PrismaClient, "$transaction">;
type Subject = { type: ComplianceSubjectType; id: string };

export type ComplianceObligation = Readonly<{
  subjectType: ComplianceSubjectType;
  subjectId: string;
  requirementId: string;
  requirementName: string;
  documentTypeId: string;
  documentTypeName: string;
  status: "COMPLIANT" | "EXPIRING_SOON" | "EXPIRED" | "MISSING";
  daysRemaining: number | null;
  reason: string | null;
  hasPendingReview: boolean;
}>;

export type ComplianceEvaluation = Readonly<{
  evaluationDate: Date;
  obligations: readonly ComplianceObligation[];
  subjectSummaries: readonly {
    subjectType: ComplianceSubjectType;
    subjectId: string;
    status: ReturnType<typeof subjectComplianceSummary>["status"];
    percentage: number | null;
  }[];
  aggregates: Readonly<
    Record<
      "DRIVER" | "VEHICLE" | "COMPANY" | "OVERALL",
      {
        applicableObligationCount: number;
        compliantOrAtRiskCount: number;
        percentage: number | null;
        activeExemptionCount: number;
        pendingReviewCount: number;
      }
    >
  >;
}>;

function aggregate(obligations: readonly ComplianceObligation[], activeExemptionCount: number) {
  const compliantOrAtRiskCount = obligations.filter(
    (item) => item.status === "COMPLIANT" || item.status === "EXPIRING_SOON",
  ).length;
  return {
    applicableObligationCount: obligations.length,
    compliantOrAtRiskCount,
    percentage:
      obligations.length === 0 ? null : (compliantOrAtRiskCount / obligations.length) * 100,
    activeExemptionCount,
    pendingReviewCount: obligations.filter((item) => item.hasPendingReview).length,
  };
}

/**
 * Computes current evidence truth from tenant rows.  It deliberately persists
 * no status or percentage: callers must supply the evaluation date explicitly.
 */
export async function evaluateCompanyCompliance(
  client: TenantClient,
  context: TenantContext,
  evaluationDate: Date,
): Promise<ComplianceEvaluation> {
  requirePermission(context, "compliance.read");
  return withTenantTransaction(client, context, async (transaction) => {
    const [
      company,
      drivers,
      vehicles,
      documentTypes,
      requirements,
      assignments,
      exemptions,
      documents,
      documentFiles,
      storedFiles,
      licences,
      licenceFiles,
    ] = await Promise.all([
      transaction.company.findUnique({
        where: { id: context.companyId },
        select: { id: true, status: true },
      }),
      transaction.driver.findMany({
        where: {
          companyId: context.companyId,
          operationalStatus: { in: ["ACTIVE", "SUSPENDED", "ON_LEAVE"] },
        },
        select: { id: true },
      }),
      transaction.vehicle.findMany({
        where: {
          companyId: context.companyId,
          operationalStatus: { in: ["ACTIVE", "OUT_OF_SERVICE"] },
        },
        select: { id: true },
      }),
      transaction.documentType.findMany({ where: { companyId: context.companyId } }),
      transaction.complianceRequirement.findMany({
        where: { companyId: context.companyId, isActive: true },
      }),
      transaction.complianceRequirementAssignment.findMany({
        where: { companyId: context.companyId, removedAt: null },
      }),
      transaction.complianceRequirementExemption.findMany({
        where: { companyId: context.companyId, revokedAt: null },
      }),
      transaction.document.findMany({ where: { companyId: context.companyId } }),
      transaction.documentFile.findMany({
        where: { companyId: context.companyId, removedAt: null },
      }),
      transaction.storedFile.findMany({ where: { companyId: context.companyId } }),
      transaction.driverLicence.findMany({ where: { companyId: context.companyId } }),
      transaction.driverLicenceFile.findMany({
        where: { companyId: context.companyId, removedAt: null },
      }),
    ]);
    const subjects: Subject[] = [
      ...drivers.map((driver) => ({ type: "DRIVER" as const, id: driver.id })),
      ...vehicles.map((vehicle) => ({ type: "VEHICLE" as const, id: vehicle.id })),
      ...(company?.status === "ACTIVE" ? [{ type: "COMPANY" as const, id: company.id }] : []),
    ];
    const availableFileIds = new Set(
      storedFiles.filter((file) => file.fileState === "AVAILABLE").map((file) => file.id),
    );
    const documentAvailable = new Set(
      documentFiles
        .filter((file) => availableFileIds.has(file.storedFileId))
        .map((file) => file.documentId),
    );
    const obligations: ComplianceObligation[] = [];
    const activeExemptionCount: Record<"DRIVER" | "VEHICLE" | "COMPANY", number> = {
      DRIVER: 0,
      VEHICLE: 0,
      COMPANY: 0,
    };

    for (const subject of subjects) {
      for (const requirement of requirements.filter((item) => item.subjectType === subject.type)) {
        const hasAssignment = assignments.some(
          (item) =>
            item.requirementId === requirement.id &&
            item.subjectType === subject.type &&
            (subject.type === "DRIVER"
              ? item.driverId === subject.id
              : subject.type === "VEHICLE"
                ? item.vehicleId === subject.id
                : false),
        );
        if (requirement.applicability === "SPECIFIC" && !hasAssignment) continue;
        const exempt = exemptions.some(
          (item) =>
            item.requirementId === requirement.id &&
            item.subjectType === subject.type &&
            isExemptionEffective(item.effectiveFrom, item.expiresOn, evaluationDate) &&
            (subject.type === "DRIVER"
              ? item.driverId === subject.id
              : subject.type === "VEHICLE"
                ? item.vehicleId === subject.id
                : item.companySubjectId === subject.id),
        );
        // A SPECIFIC exemption is meaningful only with its active assignment.
        if (exempt && (requirement.applicability !== "SPECIFIC" || hasAssignment)) {
          activeExemptionCount[subject.type] += 1;
          continue;
        }

        const documentType = documentTypes.find((item) => item.id === requirement.documentTypeId);
        if (!documentType) continue;
        const identity = {
          requirementName: requirement.name,
          documentTypeId: documentType.id,
          documentTypeName: documentType.name,
        };
        if (documentType.evidenceSourceType === "DOCUMENT") {
          const typeDocuments = documents.filter(
            (document) =>
              document.documentTypeId === requirement.documentTypeId &&
              document.subjectType === subject.type &&
              (subject.type === "DRIVER"
                ? document.driverId === subject.id
                : subject.type === "VEHICLE"
                  ? document.vehicleId === subject.id
                  : document.companySubjectId === subject.id),
          );
          const candidates: EvidenceCandidate[] = typeDocuments.map((document) => ({
            id: document.id,
            createdAt: document.createdAt,
            validFrom: document.validFrom,
            expiryDate: document.expiryDate,
            usable:
              document.reviewStatus === "APPROVED" &&
              !document.archivedAt &&
              !document.revokedAt &&
              documentAvailable.has(document.id),
            pending:
              document.reviewStatus === "PENDING_REVIEW" &&
              !document.archivedAt &&
              !document.revokedAt,
          }));
          const evidence = evaluateEvidence(
            candidates,
            evaluationDate,
            requirement.expiryWarningDays,
          );
          obligations.push({
            subjectType: subject.type,
            subjectId: subject.id,
            requirementId: requirement.id,
            ...identity,
            ...evidence,
          });
        } else if (subject.type === "DRIVER") {
          const selection = selectDriverLicence(
            licences.filter((licence) => licence.driverId === subject.id),
            evaluationDate,
          );
          if (selection.kind !== "RESOLVED") {
            obligations.push({
              subjectType: subject.type,
              subjectId: subject.id,
              requirementId: requirement.id,
              ...identity,
              status: "MISSING",
              daysRemaining: null,
              reason:
                selection.kind === "AMBIGUOUS"
                  ? "DRIVER_LICENCE_AMBIGUOUS"
                  : "NO_AUTHORITATIVE_LICENCE",
              hasPendingReview: false,
            });
            continue;
          }
          const attachments = licenceFiles.filter(
            (attachment) =>
              attachment.driverLicenceId === selection.licence.id &&
              availableFileIds.has(attachment.storedFileId),
          );
          const representation = selectDriverLicenceAttachmentRepresentation(
            attachments.map((attachment) => attachment.role),
          );
          obligations.push({
            subjectType: subject.type,
            subjectId: subject.id,
            requirementId: requirement.id,
            ...identity,
            status: representation
              ? statusForExpiry(
                  selection.licence.expiresOn,
                  evaluationDate,
                  requirement.expiryWarningDays,
                )
              : "MISSING",
            daysRemaining: representation
              ? daysUntilExpiry(selection.licence.expiresOn, evaluationDate)
              : null,
            reason: representation ? null : "LICENCE_EVIDENCE_INCOMPLETE",
            hasPendingReview: false,
          });
        }
      }
    }
    const subjectSummaries = subjects.map((subject) => {
      const own = obligations.filter(
        (item) => item.subjectType === subject.type && item.subjectId === subject.id,
      );
      return {
        subjectType: subject.type,
        subjectId: subject.id,
        ...subjectComplianceSummary(own.map((x) => x.status)),
      };
    });
    const byType = (type: "DRIVER" | "VEHICLE" | "COMPANY") =>
      aggregate(
        obligations.filter((item) => item.subjectType === type),
        activeExemptionCount[type],
      );
    return {
      evaluationDate,
      obligations,
      subjectSummaries,
      aggregates: {
        DRIVER: byType("DRIVER"),
        VEHICLE: byType("VEHICLE"),
        COMPANY: byType("COMPANY"),
        OVERALL: aggregate(
          obligations,
          activeExemptionCount.DRIVER + activeExemptionCount.VEHICLE + activeExemptionCount.COMPANY,
        ),
      },
    };
  });
}
