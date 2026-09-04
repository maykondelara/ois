import type { PrismaClient } from "@prisma/client";
import { verifyPassword } from "@/modules/identity/password.service";

type CredentialClient = Pick<PrismaClient, "user">;

export type CredentialInput = Readonly<{ email: string; password: string }>;

export async function authenticateCredentials(client: CredentialClient, input: CredentialInput) {
  const user = await client.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, passwordHash: true, accountStatus: true },
  });
  if (!user || user.accountStatus !== "ACTIVE" || !user.passwordHash) return null;
  if (!(await verifyPassword(user.passwordHash, input.password))) return null;
  return { id: user.id, email: user.email, name: user.name };
}
