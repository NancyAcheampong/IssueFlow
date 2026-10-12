import bcrypt from "bcrypt";
import type { UserRole } from "@prisma/client";
import { prisma } from "../../src/lib/prisma.js";

// Oct 12: POST /api/v1/auth/signup no longer exists (account creation
// is an admin-only action now - see modules/admin), so every test file
// that used to sign a fixture account up over HTTP needs a different
// way to get a user into the database. This creates one directly via
// Prisma instead - the same "arrange via DB, act/assert via real HTTP"
// split tests/project.test.ts and tests/user.test.ts already used
// before this change, just promoted to a shared helper now that every
// test file needs it, not just those two.
//
// Deliberately NOT a call to modules/admin/adminUsers.service.ts's
// createUser: that function is the thing POST /api/v1/admin/users
// tests exist to verify end to end (tests/adminUsers.test.ts) - every
// other test file using it too would make that coverage incidental
// everywhere instead of deliberate in one place.
const BCRYPT_COST_FACTOR = 12;

export interface CreateTestUserInput {
  email: string;
  displayName: string;
  password: string;
  role?: UserRole;
}

export async function createTestUser(input: CreateTestUserInput) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST_FACTOR);
  return prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      role: input.role ?? "MEMBER",
    },
  });
}
