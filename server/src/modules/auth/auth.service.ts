import bcrypt from "bcrypt";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import { toSafeUser, type SafeUser } from "../users/users.service.js";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

// createUser moved to modules/admin/adminUsers.service.ts (Oct 12) -
// account creation is an ADMIN action now, not self-service, so it no
// longer belongs in the auth module. This file keeps only what's still
// genuinely about authenticating an existing account.

export async function verifyCredentials(email: string, password: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { email } });

  // AUTH-07: "no account with that email" and "wrong password" get the
  // exact same error - same code, same message. If they differed, this
  // endpoint would let anyone check which emails have accounts on
  // IssueFlow just by watching which error comes back, one guess at a
  // time. Login failure is intentionally uninformative.
  if (!user) {
    throw AppError.unauthorized(INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw AppError.unauthorized(INVALID_CREDENTIALS_MESSAGE);
  }

  return toSafeUser(user);
}
