import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/AppError.js";
import { renderMarkdownToSafeHtml } from "../../lib/markdown.js";
import type { CreateCommentInput } from "./comments.schemas.js";

// MEN-01: no username field exists on User (see DECISIONS.md D-17) -
// the mention handle is the local part of a member's email (the bit
// before "@"), case-insensitive. `@jane.doe` matches
// jane.doe@example.com. Tokens are collected as a Set so the same
// mention repeated in one comment only resolves (and gets stored)
// once.
const MENTION_PATTERN = /@([a-zA-Z0-9._-]+)/g;

function extractMentionTokens(markdown: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of markdown.matchAll(MENTION_PATTERN)) {
    const token = match[1];
    if (token) {
      tokens.add(token.toLowerCase());
    }
  }
  return tokens;
}

// Only resolves against *current members of this project* - the same
// privacy boundary as everything else in this codebase (D-06): a
// comment can't be used to probe whether some arbitrary email belongs
// to a real account, or to notify someone with no access to the
// project. An unmatched token is silently dropped, not an error - a
// typo'd or nonexistent mention shouldn't block posting the comment.
async function resolveMentions(projectId: string, markdown: string): Promise<string[]> {
  const tokens = extractMentionTokens(markdown);
  if (tokens.size === 0) {
    return [];
  }

  const memberships = await prisma.projectMembership.findMany({
    where: { projectId },
    include: { user: { select: { id: true, email: true } } },
  });

  const matchedUserIds: string[] = [];
  for (const membership of memberships) {
    const localPart = membership.user.email.split("@")[0]?.toLowerCase();
    if (localPart && tokens.has(localPart)) {
      matchedUserIds.push(membership.user.id);
    }
  }
  return matchedUserIds;
}

// COM-03: a reply's parentId must name a real comment on *this same*
// issue - not some other issue's comment (which would let a reply
// thread jump between issues, or even between projects). A DB lookup,
// so it lives here rather than in the zod schema.
async function assertParentBelongsToIssue(issueId: string, parentId: string): Promise<void> {
  const parent = await prisma.comment.findUnique({ where: { id: parentId } });

  if (!parent || parent.issueId !== issueId) {
    throw AppError.badRequest("The parent comment must belong to this same issue.", {
      parentId: "Not a comment on this issue.",
    });
  }
}

// COM-01/COM-02/COM-03/MEN-01: creates a comment (optionally a
// threaded reply), rendering+sanitizing its Markdown once at write
// time (D-15) and resolving @mentions once at write time (D-17) -
// comment, HTML rendering, and mention rows all created together in
// one nested write, same atomic pattern used throughout this codebase.
export async function createComment(
  issueId: string,
  projectId: string,
  authorId: string,
  input: CreateCommentInput,
) {
  if (input.parentId) {
    await assertParentBelongsToIssue(issueId, input.parentId);
  }

  const bodyHtml = renderMarkdownToSafeHtml(input.bodyMarkdown);
  const mentionedUserIds = await resolveMentions(projectId, input.bodyMarkdown);

  return prisma.comment.create({
    data: {
      issueId,
      authorId,
      parentId: input.parentId,
      bodyMarkdown: input.bodyMarkdown,
      bodyHtml,
      mentions: {
        create: mentionedUserIds.map((userId) => ({ userId })),
      },
    },
    include: { mentions: true },
  });
}

// Flat list, oldest first - the client threads replies under their
// parent using `parentId`, same reasoning as leaving BoardPlacement's
// ranking client-agnostic (D-12): building a nested tree is a
// presentation concern, not something the API needs to pre-decide.
export async function listCommentsForIssue(issueId: string) {
  return prisma.comment.findMany({
    where: { issueId },
    orderBy: { createdAt: "asc" },
    include: { mentions: true },
  });
}
