import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import type { SignupInput } from "./auth.schemas.js";
import { toSafeUser, type SafeUser } from "../users/users.service.js";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

// Cost factor for bcrypt. 10 is bcrypt's own historical default; 12 is a
// stronger, still-fast-enough-for-a-login-request modern baseline. Higher
// = slower to brute-force but also slower per real signup/login, so this
// is a deliberate tradeoff, not an arbitrary number.
const BCRYPT_COST_FACTOR = 12;

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
