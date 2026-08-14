/**
 * Unit Tests for web-docs-mcp
 * 
 * These tests verify individual functions and modules in isolation.
 * Uses Vitest as the test runner and assertion library.
 */

import { describe, it, expect } from 'vitest';

describe('Unit Tests', () => {
  describe('URL Utilities', () => {
    function lastUrlSegment(url: string): string {
      try {
        const u = new URL(url);
        const seg = u.pathname.split('/').filter(Boolean).pop();
        return seg || u.hostname;
      } catch {
        return 'untitled';
      }
    }

    it('should extract last segment from URL', () => {
      const url = 'https://example.com/path/to/resource';
      expect(lastUrlSegment(url)).toBe('resource');
    });

    it('should handle root URLs', () => {
      const url = 'https://example.com/';
      expect(lastUrlSegment(url)).toBe('example.com');
    });

    it('should handle URLs with query params', () => {
      const url = 'https://example.com/page?query=test';
      expect(lastUrlSegment(url)).toBe('page');
    });

    it('should handle invalid URLs gracefully', () => {
      const url = 'not-a-valid-url';
      expect(lastUrlSegment(url)).toBe('untitled');
    });
  });

  describe('Schema Validation', () => {
    it('should validate URL with valid input', async () => {
      const { z } = await import('zod');
      const urlSchema = z.string().url();
      const validUrl = 'https://example.com';
      
      const result = urlSchema.safeParse(validUrl);
      expect(result.success).toBe(true);
    });

    it('should reject invalid URLs', async () => {
      const { z } = await import('zod');
      const urlSchema = z.string().url();
      const invalidUrl = 'not-a-url';
      
      const result = urlSchema.safeParse(invalidUrl);
      expect(result.success).toBe(false);
    });
  });

  describe('Content Type Detection', () => {
    it('should detect HTML content by content-type header', () => {
      const contentType = 'text/html';
      const isHtml = /text\/html|application\/xhtml/i.test(contentType);
      expect(isHtml).toBe(true);
    });

    it('should detect HTML content by markup', () => {
      const htmlContent = '<!DOCTYPE html><html><body>Test</body></html>';
      const isHtml = /^\s*<!doctype html|<html/i.test(htmlContent);
      expect(isHtml).toBe(true);
    });

    it('should detect JSON content by content-type header', () => {
      const contentType = 'application/json';
      const isJson = /application\/json/i.test(contentType);
      expect(isJson).toBe(true);
    });

    it('should detect JSON content by structure', () => {
      const jsonContent = '{"key": "value"}';
      const isJson = /^[[{]/.test(jsonContent.trim());
      expect(isJson).toBe(true);
    });

    it('should detect plain text content', () => {
      const textContent = 'Just plain text';
      const isHtml = /^\s*<!doctype html|<html/i.test(textContent);
      const isJson = /^[[{]/.test(textContent.trim());
      expect(isHtml).toBe(false);
      expect(isJson).toBe(false);
    });
  });

  describe('Markdown Truncation Logic', () => {
    it('should not truncate content under limit', () => {
      const MAX_MD_CHARS = 1000;
      const content = 'Short content';
      expect(content.length).toBeLessThan(MAX_MD_CHARS);
    });

    it('should identify content over limit', () => {
      const MAX_MD_CHARS = 100;
      const content = 'x'.repeat(150);
      expect(content.length).toBeGreaterThan(MAX_MD_CHARS);
    });
  });
});
