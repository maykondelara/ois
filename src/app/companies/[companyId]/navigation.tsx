"use client";

import { usePathname } from "next/navigation";

const items = [
  ["Overview", ""],
  ["Drivers", "/drivers"],
  ["Vehicles", "/vehicles"],
  ["Compliance", "/compliance"],
  ["Inspections", "/inspections"],
  ["Issues", "/issues"],
] as const;

export default function CompanyNavigation({ companyId }: Readonly<{ companyId: string }>) {
  const pathname = usePathname();
  const root = `/companies/${companyId}`;
  return (
    <nav className="app-nav" aria-label="Company operations">
      {items.map(([label, suffix]) => {
        const href = `${root}${suffix}`;
        const active = suffix ? pathname.startsWith(href) : pathname === root;
        return (
          <a className={active ? "active" : ""} href={href} key={label}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
