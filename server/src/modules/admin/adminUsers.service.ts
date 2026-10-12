import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import { toSafeUser, type SafeUser } from "../users/users.service.js";
import type { CreateUserInput } from "./adminUsers.schemas.js";

// Cost factor for bcrypt. 10 is bcrypt's own historical default; 12 is a
// stronger, still-fast-enough-for-a-login-request modern baseline. Higher
// = slower to brute-force but also slower per create/login, so this is a
// deliberate tradeoff, not an arbitrary number. (Moved here from the old
// auth.service.ts's createUser - same constant, same reasoning.)
export const BCRYPT_COST_FACTOR = 12;

// Moved from auth.service.ts's createUser (Oct 12) - IssueFlow has no
// public signup, so creating a user is now exclusively an ADMIN action
// (see adminUsers.routes.ts's requireAuth + requireAdmin). The logic
// itself is unchanged: hash the password, insert, and let Postgres's own
// unique-constraint rejection (not a pre-check) be the actual source of
// truth for "that email's taken" - a pre-check-then-insert has a race
// condition a direct insert-and-catch doesn't.
export async function createUser(input: CreateUserInput): Promise<SafeUser> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST_FACTOR);

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      },
    });
    return toSafeUser(user);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("An account with this email already exists.");
    }
    throw err;
  }
}

// Lets the admin see who already has an account before creating a new
// one (avoids a guess-and-409 loop) and gives them some visibility into
// the user base generally, since there's no other admin surface yet.
export async function listAllUsers(): Promise<SafeUser[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return users.map(toSafeUser);
}
