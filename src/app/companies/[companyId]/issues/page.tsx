import IssuesWorkspace from "./workspace";

export default async function IssuesPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ vehicleId?: string }>;
}>) {
  const { companyId } = await params;
  const { vehicleId } = await searchParams;
  return <IssuesWorkspace companyId={companyId} initialVehicleId={vehicleId ?? ""} />;
}
