import { describe, expect, it } from "vitest";
import {
  createPasswordResetToken,
  hashPassword,
  verifyPassword,
} from "@/modules/identity/password.service";

describe("password security", () => {
  it("uses a non-plaintext Argon2id password hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong")).resolves.toBe(false);
  });

  it("returns an opaque reset token and only a deterministic hash for storage", () => {
    const issued = createPasswordResetToken();
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(issued.token).toHaveLength(43);
  });
});
