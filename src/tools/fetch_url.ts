/**
 * `fetch_url` tool — fetch a single URL and return clean markdown.
 *
 * Pipeline:
 *   1. fetchText (cached)
 *   2. If HTML → html-to-md (turndown + GFM)
 *   3. If JSON → pretty-printed code block
 *   4. Truncate to MAX_MD_CHARS
 *   5. Optionally save to docs/<slug>.md with frontmatter
 */
import { z } from "zod";
import { fetchText } from "../lib/fetcher.js";
import { htmlToMarkdown } from "../lib/html-to-md.js";
import { saveDoc } from "../lib/docs-writer.js";
import { findBySourceUrl } from "../lib/local-search.js";
import {
  DEFAULT_SAVE_TO_DOCS,
  DOCS_DIR,
  DOCS_SUBDIRS,
  MAX_MD_CHARS,
} from "../config.js";

export const fetchUrlSchema = {
  url: z
    .string()
    .url()
    .describe("Absolute http(s) URL to fetch."),
  save: z
    .boolean()
    .optional()
    .describe(
      `If true, also write the markdown to ${DOCS_DIR}/<slug>.md with frontmatter. Default ${DEFAULT_SAVE_TO_DOCS}.`,
    ),
  name: z
    .string()
    .optional()
    .describe(
      "Filename (without extension) to use when saving. Defaults to the page <title> or last URL segment.",
    ),
  subdir: z
    .string()
    .optional()
    .describe(
      "Optional subdirectory under docs/ (e.g. 'guides', 'libraries', 'api', 'specs', 'snippets'). Default 'guides'.",
    ),
  no_anubis: z
    .boolean()
    .optional()
    .describe(
      "If true, disable automatic Anubis PoW bypass. Useful for debugging or when you want the raw challenge page. Default false.",
    ),
  refresh: z
    .boolean()
    .optional()
    .describe(
      "If true, skip the local docs/ lookup (by source URL) and force a fresh fetch. Default false.",
    ),
};

export interface FetchUrlArgs {
  url: string;
  save?: boolean;
  name?: string;
  subdir?: string;
  no_anubis?: boolean;
  refresh?: boolean;
}

export async function fetchUrl(args: FetchUrlArgs): Promise<string> {
  // ---- Step 0: LOCAL-FIRST lookup by source URL ----------------------------
  // If we've previously fetched this URL and saved it to docs/, return the
  // local copy instead of hitting the network. The match is by frontmatter
  // `source:` field (normalized: protocol upgraded to https, trailing slash
  // stripped, query string removed).
  if (!args.refresh) {
    const local = findBySourceUrl(args.url);
    if (local) {
      return formatLocalFetchResult(args.url, local);
    }
  }

  const res = await fetchText(args.url, args.no_anubis ? { noAnubis: true } : {});
  if (res.status >= 400) {
    return `Fetch failed: HTTP ${res.status} for ${res.url}`;
  }

  const isHtml = /text\/html|application\/xhtml/i.test(res.contentType) ||
    /^\s*<!doctype html|<html/i.test(res.text);
  const isJson = /application\/json/i.test(res.contentType) ||
    /^[\[{]/.test(res.text.trim());

  let md: string;
  if (isHtml) {
    md = htmlToMarkdown(res.text);
    // If html-to-md didn't extract a meaningful title, fall back to URL.
    if (!args.name) {
      const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(res.text);
      args.name = titleMatch?.[1]?.trim() || lastUrlSegment(res.url);
    }
  } else if (isJson) {
    let pretty: string;
    try {
      pretty = JSON.stringify(JSON.parse(res.text), null, 2);
    } catch {
      pretty = res.text;
    }
    md = "```json\n" + pretty + "\n```\n";
    if (!args.name) args.name = lastUrlSegment(res.url);
  } else {
    // Plain text, source code, etc.
    md = "```\n" + res.text + "\n```\n";
    if (!args.name) args.name = lastUrlSegment(res.url);
  }

  // Truncate to keep agent context manageable.
  if (md.length > MAX_MD_CHARS) {
    md =
      md.slice(0, MAX_MD_CHARS) +
      `\n\n…[truncated, original ${md.length.toLocaleString()} chars; raise MAX_MD_CHARS to get full content]…`;
  }

  const wantSave = args.save ?? DEFAULT_SAVE_TO_DOCS;
  let savedNote = "";
  if (wantSave) {
    const result = saveDoc(md, {
      name: args.name || lastUrlSegment(res.url),
      subdir: args.subdir ?? DOCS_SUBDIRS.guides,
      sourceUrl: res.url,
      contentType: res.contentType || (isHtml ? "text/html" : isJson ? "application/json" : "text/plain"),
      tool: "fetch_url",
    });
    savedNote = `\n\n**Saved to:** \`${result.path}\``;
  }

  // Handle the Anubis-DENY case explicitly so the agent gets a clear message
  // instead of dumping a 2KB "Oh noes!" HTML page into context.
  if (res.anubisDenied) {
    return [
      `# Anubis DENY: ${args.url}`,
      ``,
      `The site is protected by Anubis and refused to issue a proof-of-work challenge.`,
      `This is a flat deny, NOT a solvable challenge.`,
      ``,
      `**Why this happens:**`,
      `- Client IP is on a cloud-provider blocklist (Alibaba Cloud, Huawei Cloud, etc.)`,
      `- User-Agent matches an AI-scraper deny rule`,
      `- The site has a custom strict policy for your network/region`,
      ``,
      `**Workarounds:**`,
      `1. Run from a residential / non-cloud IP (e.g. on your local machine instead of a VPS).`,
      `2. Set a different \`USER_AGENT\` env var — try a real browser UA without any bot-like suffix.`,
      `3. Use \`web_search\` to find the same content on a mirror (e.g. archive.org, Google cache).`,
      `4. Use a different source — for libraries, try \`lib_docs\` which goes through npm/PyPI/GitHub APIs.`,
      ``,
      `Raw response (first 500 chars for debugging):`,
      `\`\`\``,
      res.text.slice(0, 500),
      `\`\`\``,
    ].join("\n");
  }

  const header =
    `# ${args.name || lastUrlSegment(res.url)}\n` +
    `**Source:** ${res.url}\n` +
    `**Fetched:** ${new Date().toISOString()}  ·  **HTTP:** ${res.status}  ·  **Type:** ${res.contentType || "?"}` +
    `${res.fromCache ? "  ·  **cache:** hit" : ""}` +
    `${res.anubisBypassed ? "  ·  **anubis:** bypassed (PoW solved)" : ""}\n\n---\n\n`;

  return header + md + savedNote;
}

/** Format a local-doc hit (matched by source URL) as a tool response. */
function formatLocalFetchResult(originalUrl: string, doc: import("../lib/local-search.js").Doc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}  ·  *(from local docs)*`);
  lines.push(``);
  lines.push(`**Requested URL:** ${originalUrl}`);
  lines.push(`**Local path:** \`${doc.relativePath}\``);
  if (doc.frontmatter.source) {
    lines.push(`**Saved from:** ${doc.frontmatter.source}`);
  }
  if (doc.frontmatter.fetched_at) {
    lines.push(`**Fetched at:** ${doc.frontmatter.fetched_at}`);
  }
  if (doc.frontmatter.content_type) {
    lines.push(`**Content type:** ${doc.frontmatter.content_type}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(doc.body);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Loaded from local docs (matched by source URL in frontmatter).*`);
  lines.push(`*Pass \`refresh: true\` to force a fresh fetch from upstream.*`);
  return lines.join("\n");
}

function lastUrlSegment(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    return seg || u.hostname;
  } catch {
    return "untitled";
  }
}
