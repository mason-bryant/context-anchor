/** Conservative, read-only suggestions for converting known inline-code references into Markdown links. */
export type MarkdownLinkSuggestion = { line: number; reference: string; replacement: string; url: string };
export type MarkdownLinkSuggestionResult = { suggestions: MarkdownLinkSuggestion[]; suggestedContent: string };

type KnownLink = { label: string; url: string };
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const URL = /https?:\/\/[^\s)}\]]+/gi;
const INLINE_CODE = /`([^`\n]+)`/g;

export function suggestMarkdownLinks(content: string): MarkdownLinkSuggestionResult {
  const links = collectKnownLinks(content);
  const suggestions: MarkdownLinkSuggestion[] = [];
  const suggestedContent = content.split(/\r?\n/).map((line, index) => line.replace(INLINE_CODE, (whole, raw: string) => {
    const suggestion = suggestionFor(raw, links, index + 1);
    if (!suggestion) return whole;
    suggestions.push(suggestion);
    return suggestion.replacement;
  })).join("\n");
  return { suggestions, suggestedContent };
}

function collectKnownLinks(content: string): KnownLink[] {
  const links: KnownLink[] = [];
  for (const match of content.matchAll(MARKDOWN_LINK)) links.push({ label: match[1] ?? "", url: match[2] ?? "" });
  for (const match of content.matchAll(URL)) {
    const url = trimTrailingUrlPunctuation(match[0] ?? "");
    if (url) links.push({ label: "", url });
  }
  return links;
}

function suggestionFor(reference: string, links: KnownLink[], line: number): MarkdownLinkSuggestion | undefined {
  const google = /^Google Doc\s+"(.+)"\s+\(doc id\s+([A-Za-z0-9_-]+)\)$/i.exec(reference);
  if (google) {
    const [, title, id] = google;
    const url = uniqueUrl(links.filter((link) => new RegExp(`/document/d/${escapeRegex(id)}(?:[/?#]|$)`).test(link.url)));
    return url ? makeSuggestion(line, reference, title, url) : undefined;
  }
  const confluence = /^([A-Za-z0-9_-]+)\/pages\/(\d+)$/.exec(reference);
  if (confluence) {
    const [, space, pageId] = confluence;
    const matches = links.filter((link) => new RegExp(`/spaces/${escapeRegex(space)}/pages/${escapeRegex(pageId)}(?:[/?#]|$)`, "i").test(link.url));
    const url = uniqueUrl(matches);
    const title = uniqueLabel(matches);
    return url && title ? makeSuggestion(line, reference, title, url) : undefined;
  }
  if (/^#[A-Za-z][A-Za-z0-9_-]*$/.test(reference)) {
    const matches = links.filter((link) => link.label.trim().toLowerCase() === reference.toLowerCase());
    const url = uniqueUrl(matches);
    return url ? makeSuggestion(line, reference, reference, url) : undefined;
  }
  return undefined;
}

function makeSuggestion(line: number, reference: string, label: string, url: string): MarkdownLinkSuggestion {
  return { line, reference, replacement: `[${label}](${url})`, url };
}
function uniqueUrl(links: KnownLink[]): string | undefined { const urls = [...new Set(links.map((link) => link.url))]; return urls.length === 1 ? urls[0] : undefined; }
function uniqueLabel(links: KnownLink[]): string | undefined { const labels = [...new Set(links.map((link) => link.label.trim()).filter(Boolean))]; return labels.length === 1 ? labels[0] : undefined; }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function trimTrailingUrlPunctuation(value: string): string { return value.replace(/[.,;:!?]+$/, ""); }
