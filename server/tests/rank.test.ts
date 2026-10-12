import { describe, expect, it } from "vitest";
import { rankBetween } from "../src/lib/rank.js";

// Oct 7 ("fill in missing tests"): D-19's fractional-indexing is
// foundational, load-bearing logic (every card's position on the
// board depends on it) that until now was only ever exercised
// *indirectly*, through board.test.ts/issues.test.ts's HTTP-level
// assertions about which title ends up in which array position. This
// tests the actual property that matters directly: every generated
// key sorts correctly against its neighbors using plain string
// comparison (`<`/`>`), the same comparison board.service.ts actually
// uses - not `fractional-indexing`'s own test suite (that's someone
// else's job to have already done), but that this project's thin
// wrapper around it is used correctly.
describe("rankBetween", () => {
  it("generates a key between two existing ranks that sorts correctly", () => {
    const key = rankBetween("a0", "a1");
    expect(key > "a0").toBe(true);
    expect(key < "a1").toBe(true);
  });

  it("generates a key after the given rank when there's no upper bound (bottom of column)", () => {
    const key = rankBetween("a0", null);
    expect(key > "a0").toBe(true);
  });

  it("generates a key before the given rank when there's no lower bound (top of column)", () => {
    const key = rankBetween(null, "a1");
    expect(key < "a1").toBe(true);
  });

  it("generates a key for an empty column (both bounds null/undefined)", () => {
    const key = rankBetween(undefined, undefined);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("treats undefined the same as null for both bounds", () => {
    const withNull = rankBetween(null, null);
    const withUndefined = rankBetween(undefined, undefined);
    // Same inputs, same deterministic output - not proving they're
    // interchangeable by coincidence.
    expect(withNull).toBe(withUndefined);
  });

  it("repeatedly inserting at the bottom keeps everything in creation order", () => {
    // This is exactly what createIssue does for every new card in a
    // column (D-19): rankBetween(lastRank, null), over and over.
    let rank = rankBetween(null, null);
    const ranks = [rank];
    for (let i = 0; i < 20; i++) {
      rank = rankBetween(rank, null);
      ranks.push(rank);
    }

    const sorted = [...ranks].sort();
    expect(ranks).toEqual(sorted);
  });

  it("repeatedly inserting between the same two neighbors stays correctly ordered", () => {
    // What moveIssue does for several cards dropped into the same
    // gap in a row: each new key must land strictly between the two
    // original bounds, and strictly ordered relative to every other
    // key inserted into that same gap.
    const lower = "a0";
    const upper = "a1";
    const inserted: string[] = [];
    let currentUpper: string = upper;

    for (let i = 0; i < 10; i++) {
      const key = rankBetween(lower, currentUpper);
      expect(key > lower).toBe(true);
      expect(key < currentUpper).toBe(true);
      inserted.unshift(key);
      currentUpper = key;
    }

    const sorted = [...inserted].sort();
    expect(inserted).toEqual(sorted);
  });
});
