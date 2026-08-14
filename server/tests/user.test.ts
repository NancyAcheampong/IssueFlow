import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// Integration test: this genuinely talks to a real Postgres database
// (issueflow_test - see tests/setup.ts and the README) rather than
// mocking Prisma. The point is to prove the migration we just ran
// actually enforces what we designed - a schema file that merely
// *looks* right isn't the same as one that's been run against a real
// database and behaves correctly.
describe("User model", () => {
  const testEmail = `user-model-test-${Date.now()}@example.com`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  it("creates and reads back a user with all fields intact", async () => {
    const created = await prisma.user.create({
      data: {
        email: testEmail,
        displayName: "Test User",
        // Not a real bcrypt hash - hashing itself is Aug 15's task. This
        // just proves the column round-trips a string correctly.
        passwordHash: "placeholder-not-a-real-hash",
      },
    });

    expect(created.id).toBeTruthy();
    expect(created.email).toBe(testEmail);
    expect(created.displayName).toBe("Test User");
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const found = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(found?.id).toBe(created.id);
  });

  it("rejects a second user with the same email (the unique constraint from the migration)", async () => {
    await expect(
      prisma.user.create({
        data: {
          email: testEmail,
          displayName: "Duplicate Attempt",
          passwordHash: "another-placeholder",
        },
      }),
    ).rejects.toThrow();
  });
});
