import ComplianceWorkspace from "./workspace";

export default async function CompliancePage({
  params,
}: Readonly<{ params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return <ComplianceWorkspace companyId={companyId} />;
}
