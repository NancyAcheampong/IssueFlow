import { generateKeyBetween } from "fractional-indexing";

// DECISIONS.md D-19 (resolves D-03, deferred since Phase 2/D-12):
// `BoardPlacement.rank` uses fractional/lexicographic indexing - every
// key sorts correctly against every other key using plain string
// comparison (`<`/`>`, not locale-aware `localeCompare`), so inserting
// a card between two existing ones never requires touching any other
// row's rank. `fractional-indexing` (rocicorp/Figma's own approach,
// battle-tested rather than hand-rolled here) is the actual key
// generator; this module is a thin, intention-revealing wrapper around
// it so callers say "rank a card between these two" instead of reaching
// for the library directly.
//
// `before`/`after` are the ranks of the cards that should end up
// immediately above/below the new one - either may be null/undefined
// for "top of the column" / "bottom of the column".
export function rankBetween(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  return generateKeyBetween(before ?? null, after ?? null);
}
