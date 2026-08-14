#!/usr/bin/env node
/**
 * web-docs-mcp — local MCP server for Kilo Code / Cline / Claude Desktop.
 *
 * Exposes 4 tools:
 *   - web_search   : free DuckDuckGo HTML search
 *   - fetch_url    : URL → clean markdown (cached, optionally saved to docs/)
 *   - lib_docs     : npm/PyPI/crates/Go/GitHub library README lookup
 *   - search_docs  : language & API documentation search biased to MDN/docs.python.org/etc.
 *
 * Configuration via env vars (see src/config.ts):
 *   DOCS_DIR, CACHE_DIR, CACHE_TTL_HOURS, HTTP_TIMEOUT_MS, USER_AGENT,
 *   DEFAULT_SAVE_TO_DOCS, DISABLE_CACHE, GITHUB_TOKEN
 *
 * Stdio transport only — that's what Kilo Code expects for local servers.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { banner } from "./config.js";
import { ensureCacheDir } from "./lib/cache.js";
import { zodToJsonSchema } from "./lib/zod-to-json.js";
import { webSearch, webSearchSchema } from "./tools/web_search.js";
import { fetchUrl, fetchUrlSchema } from "./tools/fetch_url.js";
import { libDocs, libDocsSchema } from "./tools/lib_docs.js";
import { searchDocs, searchDocsSchema } from "./tools/search_docs.js";
import { listDocs, listDocsSchema } from "./tools/list_docs.js";
// Initialize the cache directory at startup.
ensureCacheDir();
console.error(banner());
const server = new Server({ name: "web-docs-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
// Convert our zod schemas to plain JSON Schema objects that MCP expects.
const TOOLS = [
    {
        name: "web_search",
        description: "Free web search via DuckDuckGo HTML (no API key, no per-query cost). " +
            "Returns a list of {title, url, snippet}. Pass any URL to `fetch_url` for full content.",
        schema: webSearchSchema,
        handler: (args) => webSearch(args),
    },
    {
        name: "fetch_url",
        description: "Fetch a single URL and return clean markdown. Handles HTML (via turndown+GFM), " +
            "JSON (pretty-printed), and plain text. Cached locally. Optionally saves to docs/<slug>.md " +
            "with YAML frontmatter (source URL, fetch date, content type).",
        schema: fetchUrlSchema,
        handler: (args) => fetchUrl(args),
    },
    {
        name: "lib_docs",
        description: "Fetch README/docs for a library by name. Tries npm → PyPI → crates.io → Go → GitHub " +
            "automatically. Accepts `react`, `numpy`, `serde`, `owner/repo`, etc. " +
            "Optionally saves to docs/libraries/<name>.md.",
        schema: libDocsSchema,
        handler: (args) => libDocs(args),
    },
    {
        name: "search_docs",
        description: "Language & API documentation search. Biases DuckDuckGo results to official docs sites " +
            "(MDN, docs.python.org, pkg.go.dev, doc.rust-lang.org, etc.). Set fetch_top=true to " +
            "retrieve the full markdown of the top hit instead of just the result list. " +
            "LOCAL-FIRST: searches your docs/ folder first; only falls back to the web if no local match.",
        schema: searchDocsSchema,
        handler: (args) => searchDocs(args),
    },
    {
        name: "list_docs",
        description: "Browse and search the local docs/ folder. Three modes: (1) no args = list all saved docs, " +
            "(2) { query } = keyword search across docs/, (3) { path } = read the full body of a specific " +
            "doc by relative path or slug. Use this BEFORE going to the web — your project may already " +
            "have the docs you need.",
        schema: listDocsSchema,
        handler: (args) => listDocs(args),
    },
];
// ---- ListTools ---------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.schema),
    })),
}));
// ---- CallTool ----------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {});
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
        return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
        };
    }
    try {
        const text = await tool.handler(args);
        return {
            content: [{ type: "text", text }],
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: `Tool ${name} failed: ${msg}\n\nThis is often a transient network/rate-limit issue. Try again, or use a different tool.`,
                },
            ],
        };
    }
});
// ---- Boot --------------------------------------------------------------------
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Keep process alive — transport owns the lifecycle.
}
main().catch((err) => {
    console.error("[web-docs-mcp] fatal:", err);
    process.exit(1);
});
