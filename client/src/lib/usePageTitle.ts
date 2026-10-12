import { useEffect } from "react";

// Oct 8 accessibility pass: React Router doesn't update document.title
// on navigation by itself, and a screen reader announces the document
// title after a route change - without this, every page after the
// first silently stayed "IssueFlow" no matter where you navigated.
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · IssueFlow` : "IssueFlow";
  }, [title]);
}
