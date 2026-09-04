import { randomBytes } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/db/prisma";
import { authenticateCredentials } from "@/auth/authenticate-credentials";
import type { PrismaClient } from "@prisma/client";

const credentialSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});
const sessionLifetimeSeconds = 8 * 60 * 60;
type AuthDataClient = Pick<PrismaClient, "user" | "session">;

export function createAuthOptions(client: AuthDataClient, secret: string): NextAuthOptions {
  return {
    secret,
    session: { strategy: "jwt", maxAge: sessionLifetimeSeconds, updateAge: 60 * 60 },
    providers: [
      CredentialsProvider({
        name: "Email and password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          const parsed = credentialSchema.safeParse(credentials);
          if (!parsed.success) return null;
          return authenticateCredentials(client, parsed.data);
        },
      }),
    ],
    callbacks: {
      async jwt({ token, user }) {
        if (!user) return token;
        const sessionToken = randomBytes(32).toString("base64url");
        const expires = new Date(Date.now() + sessionLifetimeSeconds * 1000);
        await client.session.create({
          data: {
            id: randomBytes(18).toString("base64url"),
            sessionToken,
            userId: user.id,
            expires,
          },
        });
        token.sessionToken = sessionToken;
        token.userId = user.id;
        return token;
      },
      async session({ session, token }) {
        if (!token.userId || !token.sessionToken)
          return { ...session, user: { ...session.user, id: "" } };
        const persisted = await client.session.findUnique({
          where: { sessionToken: token.sessionToken },
          select: { userId: true, expires: true },
        });
        if (!persisted || persisted.userId !== token.userId || persisted.expires <= new Date()) {
          return { ...session, user: { ...session.user, id: "" } };
        }
        const user = await client.user.findUnique({
          where: { id: persisted.userId },
          select: { accountStatus: true },
        });
        if (!user || user.accountStatus !== "ACTIVE")
          return { ...session, user: { ...session.user, id: "" } };
        session.user.id = persisted.userId;
        return session;
      },
    },
    events: {
      async signOut({ token }) {
        if (token?.sessionToken)
          await client.session.deleteMany({ where: { sessionToken: token.sessionToken } });
      },
    },
  };
}

const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required");
export const authOptions = createAuthOptions(prisma, authSecret);
