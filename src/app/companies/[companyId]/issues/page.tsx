import IssuesWorkspace from "./workspace";

export default async function IssuesPage({
  params,
}: Readonly<{ params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return <IssuesWorkspace companyId={companyId} />;
}
