import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('pure library constraints', () => {
  test('source does not import filesystem modules', () => {
    const sourceRoot = join(import.meta.dir, '..', 'src');
    const sourceFiles = walkFiles(sourceRoot);

    const forbiddenPatterns = [
      /from\s+['"](?:node:)?fs(?:\/promises)?['"]/,
      /require\(['"](?:node:)?fs(?:\/promises)?['"]\)/,
      /from\s+['"]fs(?:\/promises)?['"]/,
    ];

    const offenders: string[] = [];

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      if (forbiddenPatterns.some((pattern) => pattern.test(content))) {
        offenders.push(filePath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
