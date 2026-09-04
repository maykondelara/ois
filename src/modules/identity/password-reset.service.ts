import type { PrismaClient } from "@prisma/client";
import { AuthorizationError } from "@/lib/errors";
import {
  createPasswordResetToken,
  hashOpaqueToken,
  hashPassword,
} from "@/modules/identity/password.service";

type PasswordClient = Pick<PrismaClient, "user" | "passwordResetToken" | "$transaction">;

/** Delivery is intentionally deferred; callers pass the raw token only to a future mail provider boundary. */
export async function issuePasswordReset(client: PasswordClient, email: string) {
  const user = await client.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, accountStatus: true },
  });
  if (!user || user.accountStatus !== "ACTIVE") return null;
  const issued = createPasswordResetToken();
  await client.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { userId: user.id, token: issued.token };
}

export async function consumePasswordReset(
  client: PasswordClient,
  token: string,
  password: string,
) {
  const tokenHash = hashOpaqueToken(token);
  return client.$transaction(async (transaction) => {
    const reset = await transaction.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true },
    });
    if (!reset) throw new AuthorizationError("Password reset token is invalid or expired");
    await transaction.user.update({
      where: { id: reset.userId },
      data: { passwordHash: await hashPassword(password) },
    });
    await transaction.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    });
    return reset.userId;
  });
}
