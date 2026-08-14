/**
 * `web_search` tool — free DuckDuckGo HTML search, no API key.
 *
 * Returns a compact list of `{ title, url, snippet, display_url }` objects
 * the agent can read directly or pass to `fetch_url` for full markdown.
 */
import { z } from "zod";
import { ddgSearch } from "../lib/ddg.js";
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from "../config.js";
export const webSearchSchema = {
    query: z
        .string()
        .min(1)
        .describe("Search query (natural language, like DuckDuckGo)."),
    limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH_LIMIT)
        .optional()
        .describe(`Maximum number of results to return. Default ${DEFAULT_SEARCH_LIMIT}, hard cap ${MAX_SEARCH_LIMIT}.`),
};
export async function webSearch(args) {
    const limit = Math.min(args.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const results = await ddgSearch(args.query, limit);
    if (results.length === 0) {
        return `No DuckDuckGo results for: ${args.query}\n\nPossible reasons: rate-limited, region block, or genuinely no matches. Try rephrasing or use \`fetch_url\` if you already have a URL.`;
    }
    const lines = [
        `# DuckDuckGo search: "${args.query}"`,
        `Found ${results.length} result${results.length === 1 ? "" : "s"}.`,
        ``,
    ];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`## ${i + 1}. ${r.title}`);
        lines.push(`URL: ${r.url}`);
        if (r.displayUrl && r.displayUrl !== r.url) {
            lines.push(`Display: ${r.displayUrl}`);
        }
        if (r.snippet)
            lines.push(``, r.snippet);
        lines.push(``);
    }
    lines.push(`---`, `Tip: pass any URL above to the \`fetch_url\` tool to get the full page as markdown.`);
    return lines.join("\n");
}
