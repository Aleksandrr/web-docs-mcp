/**
 * Integration Tests for web-docs-mcp
 * 
 * These tests verify interactions between multiple modules.
 * Tests the actual integration of fetcher, converter, and writer modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Mock config for tests
const TEST_DOCS_DIR = './test_docs_temp';

vi.mock('../src/config.js', () => ({
  DEFAULT_SAVE_TO_DOCS: false,
  DOCS_DIR: TEST_DOCS_DIR,
  DOCS_SUBDIRS: { guides: 'guides', libraries: 'libraries' },
  MAX_MD_CHARS: 10000,
}));

describe('Integration Tests', () => {
  const testDir = join(process.cwd(), TEST_DOCS_DIR);

  beforeEach(() => {
    // Create temp directory for tests
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('HTML to Markdown Conversion Pipeline', () => {
    it('should convert simple HTML to markdown', async () => {
      const { htmlToMarkdown } = await import('../../build/lib/html-to-md.js');
      
      const html = `
        <!DOCTYPE html>
        <html>
          <head><title>Test Page</title></head>
          <body>
            <h1>Hello World</h1>
            <p>This is a test.</p>
          </body>
        </html>
      `;
      
      const md = htmlToMarkdown(html);
      
      expect(md).toContain('Hello World');
      expect(md).toContain('This is a test');
    });

    it('should handle complex HTML structures', async () => {
      const { htmlToMarkdown } = await import('../../build/lib/html-to-md.js');
      
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Main Title</h1>
            <h2>Subtitle</h2>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
            <code>console.log('test')</code>
          </body>
        </html>
      `;
      
      const md = htmlToMarkdown(html);
      
      expect(md).toContain('Main Title');
      expect(md).toContain('Subtitle');
      expect(md).toMatch(/Item [12]/);
    });
  });

  describe('Document Saving Pipeline', () => {
    it('should save markdown to file with frontmatter', async () => {
      const { saveDoc } = await import('../../build/lib/docs-writer.js');
      
      const markdown = '# Test Document\n\nContent here.';
      const result = saveDoc(markdown, {
        name: 'test-doc',
        subdir: 'guides',
        sourceUrl: 'https://example.com/test',
        contentType: 'text/html',
        tool: 'fetch_url',
      });
      
      // Check if save was successful (result should have path)
      expect(result).toBeDefined();
      expect(result.path).toBeDefined();
      if (result.path) {
        expect(existsSync(result.path)).toBe(true);
        const content = readFileSync(result.path, 'utf-8');
        expect(content).toContain('source: https://example.com/test');
        expect(content).toContain('# Test Document');
      }
    });

    it('should create subdirectory if not exists', async () => {
      const { saveDoc } = await import('../../build/lib/docs-writer.js');
      
      const markdown = '# Library Doc\n\nAPI documentation.';
      const result = saveDoc(markdown, {
        name: 'api-ref',
        subdir: 'libraries',
        sourceUrl: 'https://api.example.com/docs',
        contentType: 'text/html',
        tool: 'lib_docs',
      });
      
      // Check if save was successful
      expect(result).toBeDefined();
      expect(result.path).toBeDefined();
      if (result.path) {
        expect(existsSync(result.path)).toBe(true);
      }
    });
  });

  describe('Local Search Integration', () => {
    it('should find saved document by source URL', async () => {
      const { saveDoc } = await import('../../build/lib/docs-writer.js');
      const { findBySourceUrl } = await import('../../build/lib/local-search.js');
      
      // First save a document
      const markdown = '# Search Test\n\nTesting search functionality.';
      const testUrl = 'https://search-test.example.com/page';
      
      const saveResult = saveDoc(markdown, {
        name: 'search-test',
        subdir: 'guides',
        sourceUrl: testUrl,
        contentType: 'text/html',
        tool: 'fetch_url',
      });
      
      // Then try to find it
      const found = findBySourceUrl(testUrl);
      
      expect(found).toBeDefined();
      // Title might be extracted from filename or frontmatter
      expect(found?.title || found?.name).toBeDefined();
    });

    it('should return undefined for non-existent URL', async () => {
      const { findBySourceUrl } = await import('../../build/lib/local-search.js');
      
      const found = findBySourceUrl('https://nonexistent.example.com/page');
      
      expect(found).toBeUndefined();
    });
  });

  describe('JSON Handling Pipeline', () => {
    it('should pretty-print JSON content', () => {
      const jsonString = '{"name":"test","version":"1.0.0","nested":{"key":"value"}}';
      
      let pretty: string;
      try {
        pretty = JSON.stringify(JSON.parse(jsonString), null, 2);
      } catch {
        pretty = jsonString;
      }
      
      const md = '```json\n' + pretty + '\n```\n';
      
      expect(md).toContain('"name": "test"');
      expect(md).toContain('"version": "1.0.0"');
      expect(md).toContain('```json');
    });

    it('should handle invalid JSON gracefully', () => {
      const invalidJson = '{invalid json}';
      
      let pretty: string;
      try {
        pretty = JSON.stringify(JSON.parse(invalidJson), null, 2);
      } catch {
        pretty = invalidJson;
      }
      
      expect(pretty).toBe('{invalid json}');
    });
  });
});
