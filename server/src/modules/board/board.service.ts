import { prisma } from "../../lib/prisma.js";
import { issueStatusValues } from "../issues/issues.schemas.js";
import { buildIssueWhere } from "../issues/issues.service.js";
import type { IssueFilterQuery } from "../issues/issues.schemas.js";

// A board is just every issue in a project, grouped by its status
// column and ordered within each column by its BoardPlacement's rank -
// there's no separate "board" row to query (§5.2: "A card is never a
// separate copy of an issue," carried over from the Issue model's own
// comment). Sorted here in application code with a plain `<`/`>`
// string compare, not `.localeCompare()` and not a SQL `ORDER BY` -
// fractional-indexing keys (D-19) are only guaranteed to sort correctly
// under strict code-point/byte-order comparison, and `.localeCompare()`
// applies locale-aware collation rules that can disagree with that.
// (Postgres `ORDER BY` would technically be fine too, since this
// database's collation is `C.UTF-8` - see D-19 - but doing the compare
// in JS means correctness never depends on which Postgres this ends up
// running against.)
//
// SRC-01..03/D-26: `query` is the same search/filter shape the
// paginated issue list takes, run through the exact same
// `buildIssueWhere` - a card that's filtered out of the board is
// filtered out the identical way it would be filtered out of the
// list, not by a second, possibly-diverging implementation.
export async function getBoardForProject(projectId: string, query: IssueFilterQuery) {
  const issues = await prisma.issue.findMany({
    where: buildIssueWhere(projectId, query),
    include: { boardPlacement: true },
  });

  const board: Record<string, typeof issues> = {};
  for (const status of issueStatusValues) {
    board[status] = [];
  }

  for (const issue of issues) {
    board[issue.status]?.push(issue);
  }

  for (const status of issueStatusValues) {
    board[status]?.sort((a, b) => {
      const rankA = a.boardPlacement?.rank ?? "";
      const rankB = b.boardPlacement?.rank ?? "";
      if (rankA < rankB) return -1;
      if (rankA > rankB) return 1;
      return 0;
    });
  }

  return board;
}
