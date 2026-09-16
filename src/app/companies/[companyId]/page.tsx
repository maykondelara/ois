const modules = [
  [
    "Drivers",
    "Manage driver records, licences, availability and vehicle capabilities.",
    "/drivers",
  ],
  ["Vehicles", "Manage fleet records, odometer context and operational status.", "/vehicles"],
  ["Compliance", "Access the compliance workspace and operational requirements.", "/compliance"],
  ["Inspections", "Run inspections and review completed submissions.", "/inspections"],
  ["Issues", "Track defects, repairs, resolutions and vehicle release.", "/issues"],
] as const;

export default async function CompanyOverview({
  params,
}: Readonly<{ params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return (
    <main className="operations-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company operations</p>
          <h1>Overview</h1>
          <p className="page-intro">Choose an operational area to continue.</p>
        </div>
      </header>
      <section className="module-grid" aria-label="Operational areas">
        {modules.map(([title, description, path]) => (
          <a className="module-link" href={`/companies/${companyId}${path}`} key={title}>
            <strong>{title}</strong>
            <span>{description}</span>
            <b>Open area →</b>
          </a>
        ))}
      </section>
    </main>
  );
}
