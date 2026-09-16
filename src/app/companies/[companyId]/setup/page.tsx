import SetupWorkspace from "./workspace";

export default async function SetupPage({
  params,
}: Readonly<{ params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return <SetupWorkspace companyId={companyId} />;
}
