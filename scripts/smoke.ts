/**
 * Smoke test for the web-docs MCP server.
 *
 * Runs each tool directly (without spinning up the MCP transport) and
 * prints the first ~600 chars of each result. Useful for quick sanity
 * checks before wiring the server into Kilo Code.
 *
 *   npx tsx scripts/smoke.ts
 */
import { webSearch } from "../src/tools/web_search.js";
import { fetchUrl } from "../src/tools/fetch_url.js";
import { libDocs } from "../src/tools/lib_docs.js";
import { searchDocs } from "../src/tools/search_docs.js";
import { ensureCacheDir } from "../src/lib/cache.js";

function head(s: string, n: number = 600): string {
  return s.length > n ? s.slice(0, n) + `… (+${s.length - n} chars)` : s;
}

async function main(): Promise<void> {
  ensureCacheDir();

  console.log("\n=== [1] web_search: react hooks ===");
  try {
    const r = await webSearch({ query: "react hooks useEffect", limit: 3 });
    console.log(head(r));
  } catch (e) {
    console.error("FAIL:", e);
  }

  console.log("\n=== [2] lib_docs: express (npm) ===");
  try {
    const r = await libDocs({ name: "express", ecosystem: "npm" });
    console.log(head(r));
  } catch (e) {
    console.error("FAIL:", e);
  }

  console.log("\n=== [3] lib_docs: requests (pypi) ===");
  try {
    const r = await libDocs({ name: "requests", ecosystem: "pypi" });
    console.log(head(r));
  } catch (e) {
    console.error("FAIL:", e);
  }

  console.log("\n=== [4] search_docs: Array.prototype.map (mdn) ===");
  try {
    const r = await searchDocs({
      query: "Array.prototype.map",
      target: "mdn",
      fetch_top: false,
    });
    console.log(head(r));
  } catch (e) {
    console.error("FAIL:", e);
  }

  console.log("\n=== [5] fetch_url: https://example.com ===");
  try {
    const r = await fetchUrl({ url: "https://example.com" });
    console.log(head(r));
  } catch (e) {
    console.error("FAIL:", e);
  }

  console.log("\n=== done ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
