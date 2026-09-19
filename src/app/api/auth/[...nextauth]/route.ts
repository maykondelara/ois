import NextAuth from "next-auth";

import { getAuthOptions } from "@/auth";

async function handler(...args: Parameters<ReturnType<typeof NextAuth>>) {
  const authHandler = NextAuth(getAuthOptions());

  return authHandler(...args);
}

export { handler as GET, handler as POST };
