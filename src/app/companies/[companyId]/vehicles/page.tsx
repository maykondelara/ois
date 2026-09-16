import VehiclesWorkspace from "./workspace";

export default async function VehiclesPage({
  params,
}: Readonly<{ params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return <VehiclesWorkspace companyId={companyId} />;
}
