import CompanyNavigation from "./navigation";
import type { ReactNode } from "react";

export default async function CompanyLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <a className="app-brand" href={`/companies/${companyId}`}>
          <span>OIS</span>
          <strong>Operations</strong>
        </a>
        <CompanyNavigation companyId={companyId} />
        <p className="sidebar-company" title={companyId}>
          Company
          <br />
          <span>{companyId}</span>
        </p>
      </aside>
      <div className="app-content">{children}</div>
    </div>
  );
}
