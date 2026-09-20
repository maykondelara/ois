import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";

import { getAuthOptions } from "@/auth";
import { prisma } from "@/db/prisma";
import { withAuthenticatedUserTransaction } from "@/db/tenant-transaction";

export const dynamic = "force-dynamic";

export default async function AppEntryPage() {
  const session = await getServerSession(getAuthOptions());
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }

  const memberships = await withAuthenticatedUserTransaction(
    prisma,
    { userId },
    async (transaction) =>
      transaction.companyMembership.findMany({
        where: {
          userId,
          status: "ACTIVE",
        },
        select: {
          companyId: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
  );

  if (memberships.length === 0) {
    return (
      <main className="operations-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Operations Intelligence System</p>
            <h1>No company access</h1>
            <p className="page-intro">
              Your account does not have an active company membership.
            </p>
          </div>
        </header>
      </main>
    );
  }

const [membership] = memberships;

if (!membership) {
  redirect("/sign-in");
}

redirect(`/companies/${membership.companyId}`);}
