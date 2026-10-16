import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SITE = new URL('../../src/', import.meta.url);

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourceFiles(new URL(`${entry.name}/`, dir));
    // Tests may reach API code (vi.importActual of a shared rule, say); the shipped sources never may.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return /\.tsx?$/.test(entry.name) ? [new URL(entry.name, dir)] : [];
  });
}

describe('site boundary', () => {
  it('keeps the grade math out of the site sources', () => {
    expect(existsSync(new URL('domain/formula.ts', SITE))).toBe(false);
    expect(existsSync(new URL('domain/aggregate.ts', SITE))).toBe(false);
  });

  it('never imports API code from the site', () => {
    // Any quoted module path into api/src: static or dynamic imports, either quote style.
    const leaks = sourceFiles(SITE).filter((file) => /['"][^'"]*\/api\/src\//.test(readFileSync(file, 'utf8')));
    expect(leaks.map((file) => file.pathname)).toEqual([]);
  });
});
