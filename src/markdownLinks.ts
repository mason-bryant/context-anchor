/** Conservative, read-only suggestions for converting known inline-code references into Markdown links. */
import type { MarkdownLinkSuggestion, MarkdownLinkSuggestionResult } from "./types.js";

export type { MarkdownLinkSuggestion, MarkdownLinkSuggestionResult } from "./types.js";

type KnownLink = { label: string; url: string };
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const URL = /https?:\/\/[^\s)}\]]+/gi;
const INLINE_CODE = /`([^`\n]+)`/g;

export function suggestMarkdownLinks(content: string): MarkdownLinkSuggestionResult {
  const suggestions = findMarkdownLinkSuggestions(content);
  const remaining = new Map<string, MarkdownLinkSuggestion[]>();
  for (const suggestion of suggestions) {
    const items = remaining.get(suggestion.reference) ?? [];
    items.push(suggestion);
    remaining.set(suggestion.reference, items);
  }
  const suggestedContent = content.split(/\r?\n/).map((line) => line.replace(INLINE_CODE, (whole, raw: string) => {
    const suggestion = remaining.get(raw)?.shift();
    return suggestion?.replacement ?? whole;
  })).join("\n");
  return { suggestions, suggestedContent };
}

/** Scan only; used by write validation so it does not build a replacement body. */
export function findMarkdownLinkSuggestions(content: string): MarkdownLinkSuggestion[] {
  const links = collectKnownLinks(content);
  const suggestions: MarkdownLinkSuggestion[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(INLINE_CODE)) {
      const suggestion = suggestionFor(match[1] ?? "", links, index + 1);
      if (suggestion) suggestions.push(suggestion);
    }
  });
  return suggestions;
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
  return { line, reference, replacement: `[${escapeMarkdownLabel(label)}](${url})`, url };
}
function uniqueUrl(links: KnownLink[]): string | undefined { const urls = [...new Set(links.map((link) => link.url))]; return urls.length === 1 ? urls[0] : undefined; }
function uniqueLabel(links: KnownLink[]): string | undefined { const labels = [...new Set(links.map((link) => link.label.trim()).filter(Boolean))]; return labels.length === 1 ? labels[0] : undefined; }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function trimTrailingUrlPunctuation(value: string): string { return value.replace(/[.,;:!?]+$/, ""); }
function escapeMarkdownLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}
