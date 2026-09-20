import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// DECISIONS.md D-15: comment bodies are Markdown, rendered to HTML once
// at write time (not on every read, not client-side) and sanitized
// through an explicit allowlist before it's ever stored. Markdown
// itself permits raw HTML pass-through - `marked` will happily turn
// `<script>alert(1)</script>` into exactly that, verbatim - so
// rendering alone is not remotely safe; sanitize-html is what actually
// strips it. Never store or return `marked`'s raw output un-sanitized.
//
// GFM (autolinking, tables, strikethrough) on; smart typography off -
// no reason to silently rewrite an author's straight quotes/dashes.
marked.setOptions({ gfm: true });

// A conservative allowlist: enough to render everyday Markdown
// (paragraphs, emphasis, lists, code, links, blockquotes, tables)
// without ever admitting anything that executes - no <script>, no
// <style>, no event-handler attributes (onerror, onclick, ...), no
// <iframe>/<object>/<embed>, and no javascript: URLs.
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title"],
  },
  // Belt-and-suspenders on top of the tag/attribute allowlist above:
  // even an allowed `<a href>` can't carry a javascript:/data: URL.
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard",
};

// Renders author-submitted Markdown to sanitized HTML, safe to store
// and return as-is. This is the *only* place in the codebase allowed
// to call `marked.parse` directly - every other module goes through
// this function, so there's exactly one place the allowlist can drift.
export function renderMarkdownToSafeHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false });
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}
