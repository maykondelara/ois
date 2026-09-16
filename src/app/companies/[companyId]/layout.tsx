import CompanyNavigation from "./navigation";
import { requireTenantContext } from "@/auth/context";
import type { ReactNode } from "react";

export default async function CompanyLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ companyId: string }> }>) {
  const { companyId } = await params;
  const context = await requireTenantContext(companyId);
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <a className="app-brand" href={`/companies/${companyId}`}>
          <span>OIS</span>
          <strong>Operations</strong>
        </a>
        <CompanyNavigation
          companyId={companyId}
          canAccessSetup={context.permissions.has("company.read") && context.role !== "DRIVER"}
        />
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
