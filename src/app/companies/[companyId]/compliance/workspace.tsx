"use client";
/* eslint-disable no-unused-vars, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState, type FormEvent } from "react";

type SubjectType = "DRIVER" | "VEHICLE" | "COMPANY";
type Subject = {
  subjectType: SubjectType;
  subjectId: string;
  displayName: string;
  summary: Summary;
};
type Summary = {
  status: string;
  applicableRequirements: number;
  compliant: number;
  expiringSoon: number;
  expired: number;
  missing: number;
  pendingReviewCount: number;
};
type Obligation = {
  requirementId: string;
  requirementName: string;
  documentTypeName: string;
  status: string;
  daysRemaining: number | null;
  hasPendingReview: boolean;
  reasonCode: string | null;
};
type DocType = {
  id: string;
  code: string;
  name: string;
  subjectType: SubjectType;
  evidenceSourceType: "DOCUMENT" | "DRIVER_LICENCE";
  requiresIssueDate: boolean;
  requiresExpiryDate: boolean;
  isActive: boolean;
};
type Requirement = {
  id: string;
  documentTypeId: string;
  subjectType: SubjectType;
  applicability: "GLOBAL" | "SPECIFIC";
  name: string;
  expiryWarningDays: number;
  isActive: boolean;
};
type Document = {
  id: string;
  documentTypeId: string;
  subjectType: SubjectType;
  driverId: string | null;
  vehicleId: string | null;
  issueDate: string | null;
  validFrom: string | null;
  expiryDate: string | null;
  reviewStatus: string;
  rejectionReason: string | null;
  archivedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type EvidenceFile = {
  id: string;
  storedFileId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  fileState: string;
};
type Review = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: string;
};
type Capabilities = {
  canManageDocuments: boolean;
  canReviewDocuments: boolean;
  canManageCompliance: boolean;
};
type DetailCapabilities = {
  canManage: boolean;
  canReview: boolean;
  canDownload: boolean;
  canArchive: boolean;
  canRevoke: boolean;
};
type Assignment = {
  id: string;
  subjectType: SubjectType;
  driverId: string | null;
  vehicleId: string | null;
  assignedAt: string;
};
type Exemption = {
  id: string;
  subjectType: SubjectType;
  driverId: string | null;
  vehicleId: string | null;
  reason: string;
  effectiveFrom: string | null;
  expiresOn: string | null;
};
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

async function json<T>(url: string, init?: FetchOptions): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}
const send = (method: string, body: unknown): FetchOptions => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const date = (value: string | File | null) => (value ? String(value) : null);
const label = (value: string) => value.replaceAll("_", " ");

export default function ComplianceWorkspace({ companyId }: Readonly<{ companyId: string }>) {
  const base = `/api/companies/${companyId}`;
  const [tab, setTab] = useState<"subjects" | "documents" | "configuration">("subjects");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [subjectExemptions, setSubjectExemptions] = useState<Exemption[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [detailCaps, setDetailCaps] = useState<DetailCapabilities>({
    canManage: false,
    canReview: false,
    canDownload: false,
    canArchive: false,
    canRevoke: false,
  });
  const [types, setTypes] = useState<DocType[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [caps, setCaps] = useState<Capabilities>({
    canManageDocuments: false,
    canReviewDocuments: false,
    canManageCompliance: false,
  });
  const [subjectType, setSubjectType] = useState("");
  const [subjectStatus, setSubjectStatus] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSubjects = useCallback(async () => {
    const query = new URLSearchParams({ pageSize: "100" });
    if (subjectType) query.set("subjectType", subjectType);
    if (subjectStatus) query.set("status", subjectStatus);
    const result = await json<{ data: Subject[]; capabilities: Capabilities }>(
      `${base}/compliance/subjects?${query}`,
    );
    setSubjects(result.data);
    setCaps(result.capabilities);
  }, [base, subjectStatus, subjectType]);

  const loadDocuments = useCallback(async () => {
    const query = new URLSearchParams({ pageSize: "100" });
    if (reviewStatus) query.set("reviewStatus", reviewStatus);
    if (typeFilter) query.set("documentTypeId", typeFilter);
    setDocuments((await json<{ data: Document[] }>(`${base}/documents?${query}`)).data);
  }, [base, reviewStatus, typeFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadSubjects(), loadDocuments()]);
    } finally {
      setLoading(false);
    }
  }, [loadDocuments, loadSubjects]);

  useEffect(() => {
    void Promise.all([
      refresh(),
      json<{ data: Subject[] }>(`${base}/compliance/subjects?pageSize=100`).then((r) =>
        setAvailableSubjects(r.data),
      ),
      json<{ data: DocType[] }>(`${base}/document-types?pageSize=100`).then((r) =>
        setTypes(r.data),
      ),
      json<{ data: Requirement[] }>(`${base}/compliance/requirements?pageSize=100`).then((r) =>
        setRequirements(r.data),
      ),
    ]).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load compliance"),
    );
  }, [base, refresh]);

  async function loadSubject(subject: Subject) {
    const path =
      subject.subjectType === "DRIVER"
        ? `drivers/${subject.subjectId}`
        : subject.subjectType === "VEHICLE"
          ? `vehicles/${subject.subjectId}`
          : "company";
    const result = await json<{ data: { obligations: Obligation[]; exemptions: Exemption[] } }>(
      `${base}/compliance/${path}`,
    );
    setObligations(result.data.obligations);
    setSubjectExemptions(result.data.exemptions);
    setSelectedSubject(subject);
  }

  async function loadDocument(id: string) {
    const result = await json<{
      data: { document: Document; files: EvidenceFile[]; reviewHistory: Review[] };
      capabilities: DetailCapabilities;
    }>(`${base}/documents/${id}/operational`);
    setSelectedDocument(result.data.document);
    setFiles(result.data.files);
    setReviews(result.data.reviewHistory);
    setDetailCaps(result.capabilities);
  }

  async function mutate(url: string, init: FetchOptions, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await json(url, init);
      setNotice(message);
      await refresh();
      if (selectedSubject) await loadSubject(selectedSubject);
      if (selectedDocument) await loadDocument(selectedDocument.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDocument) return;
    const file = (event.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return setError("Choose a PDF, JPEG or PNG file.");
    if (file.size > 10_485_760) return setError("The selected file exceeds the 10 MB limit.");
    setBusy(true);
    setError("");
    try {
      const initiated = await json<{ data: { fileId: string; uploadUrl: string } }>(
        `${base}/files`,
        send("POST", { originalFilename: file.name }),
      );
      const put = await fetch(initiated.data.uploadUrl, { method: "PUT", body: file });
      if (!put.ok) throw new Error("Evidence upload failed");
      const finalized = await json<{ data: { fileState: string } }>(
        `${base}/files/${initiated.data.fileId}/finalize`,
        { method: "POST" },
      );
      if (finalized.data.fileState !== "AVAILABLE")
        throw new Error("Evidence was quarantined because its content was not accepted.");
      await json(
        `${base}/documents/${selectedDocument.id}/files`,
        send("POST", { storedFileId: initiated.data.fileId }),
      );
      setNotice("Evidence uploaded, verified and attached.");
      await loadDocument(selectedDocument.id);
      await refresh();
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Evidence upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function download(file: EvidenceFile) {
    try {
      const result = await json<{ data: { downloadUrl: string } }>(
        `${base}/files/${file.storedFileId}/download`,
      );
      window.open(result.data.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to download evidence");
    }
  }

  const subjectDocuments = selectedSubject
    ? documents.filter(
        (item) =>
          item.subjectType === selectedSubject.subjectType &&
          (item.subjectType === "DRIVER"
            ? item.driverId === selectedSubject.subjectId
            : item.subjectType === "VEHICLE"
              ? item.vehicleId === selectedSubject.subjectId
              : true),
      )
    : [];

  return (
    <main className="operations-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Evidence and obligations</p>
          <h1>Compliance</h1>
          <p className="page-intro">
            Track each requirement from evidence submission through review and current validity.
          </p>
        </div>
      </header>
      <nav className="workspace-tabs">
        <button className={tab === "subjects" ? "active" : ""} onClick={() => setTab("subjects")}>
          Current compliance
        </button>
        <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>
          Documents &amp; review
        </button>
        {caps.canManageCompliance ? (
          <button
            className={tab === "configuration" ? "active" : ""}
            onClick={() => setTab("configuration")}
          >
            Configuration
          </button>
        ) : null}
      </nav>
      {error ? (
        <p className="message error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="message success" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? <p className="panel empty-state">Loading compliance…</p> : null}
      {!loading && tab === "subjects" ? (
        <Subjects
          subjects={availableSubjects}
          selected={selectedSubject}
          obligations={obligations}
          exemptions={subjectExemptions}
          documents={subjectDocuments}
          types={types}
          companyId={companyId}
          subjectType={subjectType}
          subjectStatus={subjectStatus}
          setSubjectType={setSubjectType}
          setSubjectStatus={setSubjectStatus}
          select={(subject) => void loadSubject(subject)}
          openDocument={(id) => {
            setTab("documents");
            void loadDocument(id);
          }}
        />
      ) : null}
      {!loading && tab === "documents" ? (
        <Documents
          base={base}
          documents={documents}
          selected={selectedDocument}
          files={files}
          reviews={reviews}
          types={types}
          subjects={availableSubjects}
          caps={caps}
          detailCaps={detailCaps}
          busy={busy}
          reviewStatus={reviewStatus}
          typeFilter={typeFilter}
          setReviewStatus={setReviewStatus}
          setTypeFilter={setTypeFilter}
          select={(id) => void loadDocument(id)}
          reload={refresh}
          setError={setError}
          setNotice={setNotice}
          upload={upload}
          download={(file) => void download(file)}
          mutate={mutate}
        />
      ) : null}
      {!loading && tab === "configuration" && caps.canManageCompliance ? (
        <Configuration
          base={base}
          types={types}
          requirements={requirements}
          subjects={subjects}
          busy={busy}
          mutate={mutate}
          reload={async () => {
            setTypes((await json<{ data: DocType[] }>(`${base}/document-types?pageSize=100`)).data);
            setRequirements(
              (await json<{ data: Requirement[] }>(`${base}/compliance/requirements?pageSize=100`))
                .data,
            );
          }}
        />
      ) : null}
    </main>
  );
}

function Subjects(
  p: Readonly<{
    subjects: Subject[];
    selected: Subject | null;
    obligations: Obligation[];
    exemptions: Exemption[];
    documents: Document[];
    types: DocType[];
    companyId: string;
    subjectType: string;
    subjectStatus: string;
    setSubjectType: (v: string) => void;
    setSubjectStatus: (v: string) => void;
    select: (s: Subject) => void;
    openDocument: (id: string) => void;
  }>,
) {
  return (
    <div className="workspace-columns">
      <section className="panel workspace-list">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current position</p>
            <h2>Subjects</h2>
          </div>
        </div>
        <div className="filter-row compact">
          <label>
            Subject type
            <select value={p.subjectType} onChange={(e) => p.setSubjectType(e.target.value)}>
              <option value="">All types</option>
              <option>DRIVER</option>
              <option>VEHICLE</option>
              <option>COMPANY</option>
            </select>
          </label>
          <label>
            Compliance status
            <select value={p.subjectStatus} onChange={(e) => p.setSubjectStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option>COMPLIANT</option>
              <option>AT_RISK</option>
              <option>NON_COMPLIANT</option>
              <option>NOT_EVALUATED</option>
            </select>
          </label>
        </div>
        {p.subjects.length ? (
          <div className="record-list">
            {p.subjects.map((s) => (
              <button
                className={`record-row ${p.selected?.subjectId === s.subjectId ? "selected" : ""}`}
                key={s.subjectId}
                onClick={() => p.select(s)}
              >
                <span>
                  <strong>{s.displayName}</strong>
                  <small>
                    {label(s.subjectType)} · {s.summary.applicableRequirements} requirements
                  </small>
                </span>
                <b className={`status compliance-${s.summary.status.toLowerCase()}`}>
                  {label(s.summary.status)}
                </b>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">No subjects match these filters.</p>
        )}
      </section>
      <section className="panel workspace-detail">
        {p.selected ? (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">{label(p.selected.subjectType)}</p>
                <h2>{p.selected.displayName}</h2>
              </div>
              <b className={`status compliance-${p.selected.summary.status.toLowerCase()}`}>
                {label(p.selected.summary.status)}
              </b>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Compliant</dt>
                <dd>{p.selected.summary.compliant}</dd>
              </div>
              <div>
                <dt>Expiring soon</dt>
                <dd>{p.selected.summary.expiringSoon}</dd>
              </div>
              <div>
                <dt>Expired</dt>
                <dd>{p.selected.summary.expired}</dd>
              </div>
              <div>
                <dt>Missing</dt>
                <dd>{p.selected.summary.missing}</dd>
              </div>
            </dl>
            <div className="detail-section">
              <h3>Applicable requirements</h3>
              {p.obligations.length ? (
                <div className="summary-list">
                  {p.obligations.map((o) => (
                    <article key={o.requirementId}>
                      <strong>{o.requirementName}</strong>
                      <span>{o.documentTypeName}</span>
                      <b className={`status requirement-${o.status.toLowerCase()}`}>
                        {label(o.status)}
                      </b>
                      <small>
                        {o.daysRemaining === null
                          ? label(o.reasonCode ?? "No expiry")
                          : o.daysRemaining < 0
                            ? `Expired ${Math.abs(o.daysRemaining)} days ago`
                            : `${o.daysRemaining} days remaining`}
                        {o.hasPendingReview ? " · Evidence pending review" : ""}
                      </small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No applicable requirements.</p>
              )}
            </div>
            <div className="detail-section">
              <h3>Evidence records</h3>
              {p.documents.length ? (
                <div className="record-list">
                  {p.documents.map((d) => (
                    <button className="record-row" key={d.id} onClick={() => p.openDocument(d.id)}>
                      <span>
                        <strong>
                          {p.types.find((t) => t.id === d.documentTypeId)?.name ?? "Document"}
                        </strong>
                        <small>{d.expiryDate?.slice(0, 10) ?? "No expiry"}</small>
                      </span>
                      <b className={`status review-${d.reviewStatus.toLowerCase()}`}>
                        {label(d.reviewStatus)}
                      </b>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">No document evidence submitted.</p>
              )}
            </div>
            {p.exemptions.length ? (
              <div className="detail-section">
                <h3>Active exemptions</h3>
                {p.exemptions.map((item) => (
                  <p key={item.id} className="muted">
                    {item.reason}
                    {item.effectiveFrom ? ` · From ${item.effectiveFrom.slice(0, 10)}` : ""}
                    {item.expiresOn ? ` · Until ${item.expiresOn.slice(0, 10)}` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            {p.selected.subjectType !== "COMPANY" ? (
              <a
                href={`/companies/${p.companyId}/${p.selected.subjectType === "DRIVER" ? "drivers" : "vehicles"}`}
              >
                Open {p.selected.subjectType === "DRIVER" ? "driver" : "vehicle"} records
              </a>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <h2>Select a subject</h2>
            <p>Inspect requirements, evidence and current status.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Documents(
  p: Readonly<{
    base: string;
    documents: Document[];
    selected: Document | null;
    files: EvidenceFile[];
    reviews: Review[];
    types: DocType[];
    subjects: Subject[];
    caps: Capabilities;
    detailCaps: DetailCapabilities;
    busy: boolean;
    reviewStatus: string;
    typeFilter: string;
    setReviewStatus: (v: string) => void;
    setTypeFilter: (v: string) => void;
    select: (id: string) => void;
    reload: () => Promise<void>;
    setError: (v: string) => void;
    setNotice: (v: string) => void;
    upload: (e: FormEvent<HTMLFormElement>) => Promise<void>;
    download: (f: EvidenceFile) => void;
    mutate: (url: string, init: FetchOptions, message: string) => Promise<void>;
  }>,
) {
  return (
    <div className="workspace-columns">
      <section className="panel workspace-list">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence register</p>
            <h2>Documents</h2>
          </div>
        </div>
        <div className="filter-row compact">
          <label>
            Review status
            <select value={p.reviewStatus} onChange={(e) => p.setReviewStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option>PENDING_REVIEW</option>
              <option>APPROVED</option>
              <option>REJECTED</option>
            </select>
          </label>
          <label>
            Document type
            <select value={p.typeFilter} onChange={(e) => p.setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {p.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {p.documents.length ? (
          <div className="record-list">
            {p.documents.map((d) => (
              <button
                className={`record-row ${p.selected?.id === d.id ? "selected" : ""}`}
                key={d.id}
                onClick={() => p.select(d.id)}
              >
                <span>
                  <strong>
                    {p.types.find((t) => t.id === d.documentTypeId)?.name ?? "Document"}
                  </strong>
                  <small>
                    {label(d.subjectType)} · {new Date(d.createdAt).toLocaleDateString("en-AU")}
                  </small>
                </span>
                <b className={`status review-${d.reviewStatus.toLowerCase()}`}>
                  {label(d.reviewStatus)}
                </b>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">No documents match these filters.</p>
        )}
        {p.caps.canManageDocuments ? (
          <CreateDocument
            base={p.base}
            subjects={p.subjects}
            types={p.types}
            busy={p.busy}
            done={async (d) => {
              p.setNotice("Document created. Upload evidence before review.");
              await p.reload();
              p.select(d.id);
            }}
            fail={p.setError}
          />
        ) : null}
      </section>
      <section className="panel workspace-detail">
        {p.selected ? (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Document evidence</p>
                <h2>
                  {p.types.find((t) => t.id === p.selected?.documentTypeId)?.name ?? "Document"}
                </h2>
              </div>
              <b className={`status review-${p.selected.reviewStatus.toLowerCase()}`}>
                {label(p.selected.reviewStatus)}
              </b>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Subject</dt>
                <dd>{label(p.selected.subjectType)}</dd>
              </div>
              <div>
                <dt>Issue date</dt>
                <dd>{p.selected.issueDate?.slice(0, 10) ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Valid from</dt>
                <dd>{p.selected.validFrom?.slice(0, 10) ?? "Immediately"}</dd>
              </div>
              <div>
                <dt>Expiry date</dt>
                <dd>{p.selected.expiryDate?.slice(0, 10) ?? "No expiry"}</dd>
              </div>
            </dl>
            {p.selected.rejectionReason ? (
              <p className="message error">Rejection reason: {p.selected.rejectionReason}</p>
            ) : null}
            <div className="detail-section">
              <h3>Evidence files</h3>
              {p.files.length ? (
                <div className="summary-list">
                  {p.files.map((f) => (
                    <article key={f.id}>
                      <strong>{f.filename}</strong>
                      <span>
                        {f.mimeType ?? "Pending verification"} ·{" "}
                        {f.sizeBytes === null
                          ? "Unknown size"
                          : `${Math.ceil(f.sizeBytes / 1024)} KB`}
                      </span>
                      <small>{label(f.fileState)}</small>
                      {p.detailCaps.canDownload && f.fileState === "AVAILABLE" ? (
                        <button onClick={() => p.download(f)}>Download</button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No evidence file attached.</p>
              )}
              {p.detailCaps.canManage && p.selected.reviewStatus === "PENDING_REVIEW" ? (
                <form className="stack-form inset-form" onSubmit={(e) => void p.upload(e)}>
                  <label>
                    Evidence file
                    <input
                      type="file"
                      name="file"
                      accept="application/pdf,image/jpeg,image/png"
                      required
                    />
                  </label>
                  <small>
                    PDF, JPEG or PNG. Maximum 10 MB. Server verification remains authoritative.
                  </small>
                  <button className="primary" disabled={p.busy}>
                    Upload and attach
                  </button>
                </form>
              ) : null}
            </div>
            {p.detailCaps.canReview && p.selected.reviewStatus === "PENDING_REVIEW" ? (
              <div className="detail-section">
                <h3>Review decision</h3>
                <p className="muted">The creator cannot review their own document.</p>
                <button
                  className="primary"
                  disabled={p.busy}
                  onClick={() =>
                    void p.mutate(
                      `${p.base}/documents/${p.selected!.id}/approve`,
                      { method: "POST" },
                      "Document approved.",
                    )
                  }
                >
                  Approve
                </button>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void p.mutate(
                      `${p.base}/documents/${p.selected!.id}/reject`,
                      send("POST", { reason: new FormData(e.currentTarget).get("reason") }),
                      "Document rejected.",
                    );
                  }}
                >
                  <label>
                    Rejection reason
                    <input name="reason" required />
                  </label>
                  <button disabled={p.busy}>Reject</button>
                </form>
              </div>
            ) : null}
            {p.detailCaps.canArchive &&
            p.selected.reviewStatus !== "APPROVED" &&
            !p.selected.archivedAt ? (
              <div className="detail-section">
                <h3>Document lifecycle</h3>
                <button
                  disabled={p.busy}
                  onClick={() =>
                    void p.mutate(
                      `${p.base}/documents/${p.selected!.id}/archive`,
                      { method: "POST" },
                      "Document archived.",
                    )
                  }
                >
                  Archive document
                </button>
              </div>
            ) : null}
            {p.detailCaps.canRevoke &&
            p.selected.reviewStatus === "APPROVED" &&
            !p.selected.revokedAt &&
            !p.selected.archivedAt ? (
              <form
                className="stack-form decision-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void p.mutate(
                    `${p.base}/documents/${p.selected!.id}/revoke`,
                    send("POST", { reason: new FormData(event.currentTarget).get("reason") }),
                    "Document revoked. Create a new evidence record to replace it.",
                  );
                }}
              >
                <h3>Revoke or replace evidence</h3>
                <p className="muted">
                  Revocation preserves history. Create a new evidence record for the replacement.
                </p>
                <label>
                  Revocation reason
                  <input name="reason" required />
                </label>
                <button disabled={p.busy}>Revoke document</button>
              </form>
            ) : null}
            <div className="detail-section">
              <h3>Review history</h3>
              {p.reviews.length ? (
                <ol className="timeline">
                  {p.reviews.map((r) => (
                    <li key={r.id}>
                      <strong>
                        {r.fromStatus ? `${label(r.fromStatus)} → ` : ""}
                        {label(r.toStatus)}
                      </strong>
                      <small>{new Date(r.createdAt).toLocaleString("en-AU")}</small>
                      {r.reason ? <p>{r.reason}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No review decision recorded.</p>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>Select a document</h2>
            <p>Inspect files, validity and review history.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function CreateDocument(
  p: Readonly<{
    base: string;
    subjects: Subject[];
    types: DocType[];
    busy: boolean;
    done: (d: Document) => Promise<void>;
    fail: (v: string) => void;
  }>,
) {
  return (
    <form
      className="stack-form inset-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const subject = p.subjects.find(
          (s) => `${s.subjectType}:${s.subjectId}` === f.get("subject"),
        );
        if (!subject) return;
        try {
          const result = await json<{ data: Document }>(
            `${p.base}/documents`,
            send("POST", {
              documentTypeId: f.get("documentTypeId"),
              subjectType: subject.subjectType,
              ...(subject.subjectType === "DRIVER"
                ? { driverId: subject.subjectId }
                : subject.subjectType === "VEHICLE"
                  ? { vehicleId: subject.subjectId }
                  : {}),
              issueDate: date(f.get("issueDate")),
              validFrom: date(f.get("validFrom")),
              expiryDate: date(f.get("expiryDate")),
            }),
          );
          await p.done(result.data);
          e.currentTarget.reset();
        } catch (cause) {
          p.fail(cause instanceof Error ? cause.message : "Unable to create document");
        }
      }}
    >
      <h3>Add evidence record</h3>
      <label>
        Subject
        <select name="subject" required>
          <option value="">Choose subject</option>
          {p.subjects.map((s) => (
            <option key={s.subjectId} value={`${s.subjectType}:${s.subjectId}`}>
              {s.displayName} ({label(s.subjectType)})
            </option>
          ))}
        </select>
      </label>
      <label>
        Document type
        <select name="documentTypeId" required>
          <option value="">Choose type</option>
          {p.types
            .filter((t) => t.isActive && t.evidenceSourceType === "DOCUMENT")
            .map((t) => (
              <option value={t.id} key={t.id}>
                {t.name} ({label(t.subjectType)})
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Issue date
          <input type="date" name="issueDate" />
        </label>
        <label>
          Valid from
          <input type="date" name="validFrom" />
        </label>
        <label>
          Expiry date
          <input type="date" name="expiryDate" />
        </label>
      </div>
      <button className="primary" disabled={p.busy}>
        Create evidence record
      </button>
    </form>
  );
}

function Configuration(
  p: Readonly<{
    base: string;
    types: DocType[];
    requirements: Requirement[];
    subjects: Subject[];
    busy: boolean;
    mutate: (url: string, init: FetchOptions, message: string) => Promise<void>;
    reload: () => Promise<void>;
  }>,
) {
  const [selectedId, setSelectedId] = useState("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [exemptions, setExemptions] = useState<Exemption[]>([]);
  const selected = p.requirements.find((r) => r.id === selectedId);
  useEffect(() => {
    if (!selectedId) return;
    void Promise.all([
      json<{ data: Assignment[] }>(`${p.base}/compliance/requirements/${selectedId}/assignments`),
      json<{ data: Exemption[] }>(`${p.base}/compliance/requirements/${selectedId}/exemptions`),
    ]).then(([assignmentResult, exemptionResult]) => {
      setAssignments(assignmentResult.data);
      setExemptions(exemptionResult.data);
    });
  }, [p.base, selectedId]);
  return (
    <div className="configuration-grid">
      <section className="panel">
        <p className="eyebrow">Evidence catalogue</p>
        <h2>Document types</h2>
        <div className="summary-list">
          {p.types.map((t) => (
            <article key={t.id}>
              <strong>{t.name}</strong>
              <span>
                {t.code} · {label(t.subjectType)}
              </span>
              <small>
                {label(t.evidenceSourceType)}
                {t.requiresExpiryDate ? " · Expiry required" : ""}
              </small>
            </article>
          ))}
        </div>
        <form
          className="stack-form inset-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await p.mutate(
              `${p.base}/document-types`,
              send("POST", {
                code: f.get("code"),
                name: f.get("name"),
                subjectType: f.get("subjectType"),
                evidenceSourceType: f.get("evidenceSourceType"),
                requiresIssueDate: f.get("requiresIssueDate") === "on",
                requiresExpiryDate: f.get("requiresExpiryDate") === "on",
              }),
              "Document type created.",
            );
            await p.reload();
            e.currentTarget.reset();
          }}
        >
          <h3>Add document type</h3>
          <div className="form-grid">
            <label>
              Code
              <input name="code" placeholder="VEHICLE_REGISTRATION" required />
            </label>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Subject type
              <select name="subjectType">
                <option>DRIVER</option>
                <option>VEHICLE</option>
                <option>COMPANY</option>
              </select>
            </label>
            <label>
              Evidence source
              <select name="evidenceSourceType">
                <option>DOCUMENT</option>
                <option>DRIVER_LICENCE</option>
              </select>
            </label>
          </div>
          <div className="check-grid">
            <label>
              <input type="checkbox" name="requiresIssueDate" />
              Issue date required
            </label>
            <label>
              <input type="checkbox" name="requiresExpiryDate" />
              Expiry date required
            </label>
          </div>
          <button disabled={p.busy}>Create type</button>
        </form>
      </section>
      <section className="panel">
        <p className="eyebrow">Applicability</p>
        <h2>Requirements</h2>
        <div className="record-list">
          {p.requirements.map((r) => (
            <button
              className={`record-row ${selectedId === r.id ? "selected" : ""}`}
              key={r.id}
              onClick={() => setSelectedId(r.id)}
            >
              <span>
                <strong>{r.name}</strong>
                <small>
                  {label(r.subjectType)} · {r.applicability} · {r.expiryWarningDays} warning days
                </small>
              </span>
            </button>
          ))}
        </div>
        <form
          className="stack-form inset-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const type = p.types.find((t) => t.id === f.get("documentTypeId"));
            if (!type) return;
            await p.mutate(
              `${p.base}/compliance/requirements`,
              send("POST", {
                documentTypeId: type.id,
                subjectType: type.subjectType,
                applicability: f.get("applicability"),
                name: f.get("name"),
                expiryWarningDays: Number(f.get("expiryWarningDays")),
              }),
              "Requirement created.",
            );
            await p.reload();
            e.currentTarget.reset();
          }}
        >
          <h3>Add requirement</h3>
          <label>
            Document type
            <select name="documentTypeId" required>
              <option value="">Choose type</option>
              {p.types
                .filter((t) => t.isActive)
                .map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Name
            <input name="name" required />
          </label>
          <div className="form-grid">
            <label>
              Applicability
              <select name="applicability">
                <option>GLOBAL</option>
                <option>SPECIFIC</option>
              </select>
            </label>
            <label>
              Warning days
              <input type="number" name="expiryWarningDays" min="0" max="3650" defaultValue="30" />
            </label>
          </div>
          <button disabled={p.busy}>Create requirement</button>
        </form>
        {selected ? (
          <>
            <div className="detail-section">
              <h3>Active assignments and exemptions</h3>
              {assignments.map((item) => (
                <p key={item.id} className="muted">
                  Assigned to{" "}
                  {p.subjects.find(
                    (subject) => subject.subjectId === (item.driverId ?? item.vehicleId),
                  )?.displayName ?? label(item.subjectType)}{" "}
                  on {item.assignedAt.slice(0, 10)}
                </p>
              ))}
              {exemptions.map((item) => (
                <p key={item.id} className="muted">
                  Exempt:{" "}
                  {p.subjects.find(
                    (subject) => subject.subjectId === (item.driverId ?? item.vehicleId),
                  )?.displayName ?? label(item.subjectType)}{" "}
                  — {item.reason}
                  {item.expiresOn ? ` until ${item.expiresOn.slice(0, 10)}` : ""}
                </p>
              ))}
              {!assignments.length && !exemptions.length ? (
                <p className="muted">No active assignments or exemptions.</p>
              ) : null}
            </div>
            <SubjectAction
              title="Assign selected requirement"
              button="Assign"
              requirement={selected}
              subjects={p.subjects}
              busy={p.busy}
              onSubmit={(subject) =>
                p.mutate(
                  `${p.base}/compliance/requirements/${selected.id}/assignments`,
                  send("POST", {
                    subjectType: subject.subjectType,
                    ...(subject.subjectType === "DRIVER"
                      ? { driverId: subject.subjectId }
                      : { vehicleId: subject.subjectId }),
                  }),
                  "Requirement assigned.",
                )
              }
            />
            <form
              className="stack-form inset-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const subject = p.subjects.find((s) => s.subjectId === f.get("subjectId"));
                if (!subject) return;
                void p.mutate(
                  `${p.base}/compliance/requirements/${selected.id}/exemptions`,
                  send("POST", {
                    subjectType: subject.subjectType,
                    ...(subject.subjectType === "DRIVER"
                      ? { driverId: subject.subjectId }
                      : subject.subjectType === "VEHICLE"
                        ? { vehicleId: subject.subjectId }
                        : {}),
                    reason: f.get("reason"),
                    effectiveFrom: date(f.get("effectiveFrom")),
                    expiresOn: date(f.get("expiresOn")),
                  }),
                  "Exemption granted.",
                );
              }}
            >
              <h3>Exempt selected requirement</h3>
              <label>
                Subject
                <select name="subjectId" required>
                  <option value="">Choose subject</option>
                  {p.subjects
                    .filter((s) => s.subjectType === selected.subjectType)
                    .map((s) => (
                      <option value={s.subjectId} key={s.subjectId}>
                        {s.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Reason
                <input name="reason" required />
              </label>
              <div className="form-grid">
                <label>
                  Effective from
                  <input type="date" name="effectiveFrom" />
                </label>
                <label>
                  Expires on
                  <input type="date" name="expiresOn" />
                </label>
              </div>
              <button disabled={p.busy}>Grant exemption</button>
            </form>
          </>
        ) : (
          <p className="muted">Select a requirement to assign it or grant an exemption.</p>
        )}
      </section>
    </div>
  );
}

function SubjectAction(
  p: Readonly<{
    title: string;
    button: string;
    requirement: Requirement;
    subjects: Subject[];
    busy: boolean;
    onSubmit: (s: Subject) => Promise<void>;
  }>,
) {
  return (
    <form
      className="stack-form inset-form"
      onSubmit={(e) => {
        e.preventDefault();
        const id = new FormData(e.currentTarget).get("subjectId");
        const subject = p.subjects.find((s) => s.subjectId === id);
        if (subject) void p.onSubmit(subject);
      }}
    >
      <h3>{p.title}</h3>
      <label>
        Subject
        <select name="subjectId" required>
          <option value="">Choose subject</option>
          {p.subjects
            .filter(
              (s) => s.subjectType === p.requirement.subjectType && s.subjectType !== "COMPANY",
            )
            .map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.displayName}
              </option>
            ))}
        </select>
      </label>
      <button disabled={p.busy || p.requirement.applicability !== "SPECIFIC"}>{p.button}</button>
    </form>
  );
}
