import { clerkClient, verifyToken } from "@clerk/express";

type OperatorBackend = {
  verify: (token: string) => Promise<{ sub: string; sid?: string }>;
  session: (id: string) => Promise<{ status: string; userId: string }>;
  user: (id: string) => Promise<{ privateMetadata: Record<string, unknown> }>;
};

const backend: OperatorBackend = {
  verify: token => verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY }),
  session: id => clerkClient.sessions.getSession(id),
  user: id => clerkClient.users.getUser(id),
};

// Only a verified, active Clerk session plus a server-managed privilege qualifies.
// Never accept a caller-supplied operator name or user-editable unsafeMetadata.
export async function authenticateRecoveryOperator(token: string, auth = backend): Promise<string> {
  if (!token || token.length > 16384) throw new Error("Operator session required.");
  const claims = await auth.verify(token);
  if (!claims.sid || !claims.sub) throw new Error("Operator session required.");
  const [session, user] = await Promise.all([
    auth.session(claims.sid),
    auth.user(claims.sub),
  ]);
  if (
    session.status !== "active" || session.userId !== claims.sub ||
    user.privateMetadata.legacyRecoveryOperator !== true
  ) throw new Error("Recovery operator permission required.");
  return claims.sub;
}
