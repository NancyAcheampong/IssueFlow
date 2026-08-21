import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";

// AUTH-03: passwords are hashed before persistence and never returned by
// any API. This is the "safe to send to a client" shape of a user - every
// route that returns a user should go through this, never the raw Prisma
// row, so passwordHash can never accidentally leak into a response.
// Lives here (not in the auth module) because it's about the User model
// generally - both auth.service.ts and GET /me need it.
export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

export function toSafeUser(user: { id: string; email: string; displayName: string; createdAt: Date }): SafeUser {
  return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt };
}

export async function getUserById(id: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id } });

  // A JWT can still verify successfully after the account it names has
  // been deleted (deleted between issuing and using the token) - this is
  // what catches that case, rather than the route returning a broken
  // response. Same error as "not authenticated" on purpose: from the
  // caller's side, a token for a deleted account isn't meaningfully
  // different from an invalid one.
  if (!user) {
    throw AppError.unauthorized();
  }

  return toSafeUser(user);
}
