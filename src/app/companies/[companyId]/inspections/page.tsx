import InspectionWorkspace from "./workspace";

export default async function InspectionPage({
  params,
}: Readonly<{ params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return <InspectionWorkspace companyId={companyId} />;
}
