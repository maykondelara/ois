import DriversWorkspace from "./workspace";

export default async function DriversPage({
  params,
}: Readonly<{ params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return <DriversWorkspace companyId={companyId} />;
}
