/**
 * HTML → Markdown converter built on `turndown` + the GFM plugin
 * (tables, strikethrough, task lists). Strips noise (scripts, styles,
 * nav, footer, ads) before conversion so the agent gets clean content.
 */
import TurndownService from "turndown";
// turndown-plugin-gfm ships without type declarations.
// @ts-expect-error — module exists at runtime.
import * as turndownPluginGfm from "turndown-plugin-gfm";

const service = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

service.use((turndownPluginGfm as any).gfm);

// Drop noisy elements entirely.
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "footer",
  "header[role=banner]",
  "aside",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  ".ad",
  ".ads",
  ".adsbygoogle",
  ".sidebar",
  ".navbar",
  ".cookie-banner",
  ".cookie-consent",
  ".breadcrumbs",
  ".social-share",
  ".related-posts",
  "#comments",
];

service.addRule("stripNoise", {
  filter: (node: any) => {
    if (!node || !node.tagName) return false;
    const tag = node.tagName.toLowerCase();
    if (NOISE_SELECTORS.includes(tag)) return true;
    const cls = (node.getAttribute?.("class") || "").toLowerCase();
    if (
      /\b(sidebar|cookie|banner|advert|ads|social|share|related|newsletter|subscribe)\b/.test(
        cls,
      )
    ) {
      return true;
    }
    return false;
  },
  replacement: () => "",
});

/**
 * Convert raw HTML to a clean Markdown string.
 *
 * Tries to locate the main content area first (article, main, #content,
 * .documentation, .markdown-body, …) so the agent doesn't drown in chrome.
 */
export function htmlToMarkdown(html: string): string {
  // Quick content-area extraction without a full DOM library here —
  // turndown will only see what we pass it, so we slice first using
  // a couple of cheap regex heuristics. cheerio is used separately in
  // ddg.ts where structural parsing is needed.
  let slice = html;
  const mainMatch =
    /<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i.exec(html);
  if (mainMatch) {
    slice = mainMatch[1];
  } else {
    const contentMatch =
      /<div[^>]*(?:id="content"|class="[^"]*(?:content|documentation|markdown-body|prose|entry-content|post-content)[^"]*")[^>]*>([\s\S]*?)<\/div>/i.exec(
        html,
      );
    if (contentMatch) slice = contentMatch[1];
  }

  let md: string;
  try {
    md = service.turndown(slice);
  } catch {
    md = service.turndown(html);
  }

  // Collapse excessive blank lines that turndown sometimes emits.
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}
