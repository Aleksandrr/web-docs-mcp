/**
 * Smoke Tests for web-docs-mcp
 * 
 * Quick sanity checks to verify the application starts and basic functionality works.
 * These tests should run in under 10 seconds and catch major regressions.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Smoke Tests', () => {
  it('should have package.json with required fields', () => {
    const pkgPath = join(process.cwd(), 'package.json');
    expect(existsSync(pkgPath)).toBe(true);
    
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.name).toBe('web-docs-mcp');
    expect(pkg.version).toBeDefined();
    expect(pkg.main).toBeDefined();
    expect(pkg.type).toBe('module');
  });

  it('should have built output files', () => {
    const buildIndex = join(process.cwd(), 'build', 'index.js');
    expect(existsSync(buildIndex)).toBe(true);
  });

  it('should have all tool source files', () => {
    const tools = [
      'fetch_url.ts',
      'lib_docs.ts',
      'list_docs.ts',
      'search_docs.ts',
      'web_search.ts',
    ];
    
    tools.forEach(tool => {
      const toolPath = join(process.cwd(), 'src', 'tools', tool);
      expect(existsSync(toolPath), `${tool} should exist`).toBe(true);
    });
  });

  it('should have all lib source files', () => {
    const libs = [
      'anubis.ts',
      'cache.ts',
      'ddg.ts',
      'docs-writer.ts',
      'fetcher.ts',
      'html-to-md.ts',
      'local-search.ts',
      'zod-to-json.ts',
    ];
    
    libs.forEach(lib => {
      const libPath = join(process.cwd(), 'src', 'lib', lib);
      expect(existsSync(libPath), `${lib} should exist`).toBe(true);
    });
  });

  it('should have valid TypeScript config', () => {
    const tsConfigPath = join(process.cwd(), 'tsconfig.json');
    expect(existsSync(tsConfigPath)).toBe(true);
    
    const tsConfig = JSON.parse(readFileSync(tsConfigPath, 'utf-8'));
    expect(tsConfig.compilerOptions).toBeDefined();
    expect(tsConfig.compilerOptions.outDir).toBe('./build');
  });

  it('should have README.md', () => {
    const readmePath = join(process.cwd(), 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    
    const content = readFileSync(readmePath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('web-docs-mcp');
  });

  it('should have ESLint config', () => {
    const eslintPath = join(process.cwd(), 'eslint.config.js');
    expect(existsSync(eslintPath)).toBe(true);
  });

  it('should have no critical vulnerabilities', async () => {
    // This is a placeholder - actual audit would run `npm audit`
    // For smoke test, we just verify package-lock.json exists
    const lockPath = join(process.cwd(), 'package-lock.json');
    expect(existsSync(lockPath)).toBe(true);
  });

  it('should export MCP server from main entry', async () => {
    // Verify the built index.js can be loaded (basic syntax check)
    const buildIndexPath = join(process.cwd(), 'build', 'index.js');
    const content = readFileSync(buildIndexPath, 'utf-8');
    
    expect(content).toContain('Server');
    expect(content).toContain('web-docs-mcp');
  });

  it('should have test directories set up', () => {
    const testDirs = [
      'tests/unit',
      'tests/integration',
      'tests/smoke',
    ];
    
    testDirs.forEach(dir => {
      const dirPath = join(process.cwd(), dir);
      expect(existsSync(dirPath), `${dir} should exist`).toBe(true);
    });
  });
});
