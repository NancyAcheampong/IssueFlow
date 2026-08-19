import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import type { SignupInput } from "./auth.schemas.js";

// Cost factor for bcrypt. 10 is bcrypt's own historical default; 12 is a
// stronger, still-fast-enough-for-a-login-request modern baseline. Higher
// = slower to brute-force but also slower per real signup/login, so this
// is a deliberate tradeoff, not an arbitrary number.
const BCRYPT_COST_FACTOR = 12;

// AUTH-03: passwords are hashed before persistence and never returned by
// any API. This is the "safe to send to a client" shape of a user - every
// route that returns a user should go through this, never the raw Prisma
// row, so passwordHash can never accidentally leak into a response.
export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

function toSafeUser(user: { id: string; email: string; displayName: string; createdAt: Date }): SafeUser {
  return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt };
}

export async function createUser(input: SignupInput): Promise<SafeUser> {
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
    // A pre-check ("does this email already exist?") followed by an
    // insert has a race condition: two signups for the same email can
    // both pass the check before either one inserts. Instead we just
    // attempt the insert and translate Postgres's own unique-constraint
    // rejection (Prisma error code P2002) into our error shape - the
    // database is the actual source of truth for uniqueness here.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("An account with this email already exists.");
    }
    throw err;
  }
}
