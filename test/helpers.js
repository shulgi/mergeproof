import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMapping } from '../src/mapping.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(ROOT, 'bin', 'mergeproof.js');

/**
 * Build strings from code points. Tests use this instead of escape sequences so
 * that invisible or decomposed characters are explicit in the source.
 */
export const cp = (...codes) => String.fromCodePoint(...codes);
export const BOM = cp(0xfeff);
export const NBSP = cp(0x00a0);
export const COMBINING_ACUTE = cp(0x0301);
export const COMBINING_GRAVE = cp(0x0300);
export const COMBINING_DIAERESIS = cp(0x0308);
export const E_ACUTE = cp(0x00e9);
export const E_GRAVE = cp(0x00e8);
export const O_DIAERESIS = cp(0x00d6);

/** Temporary directory whose path contains spaces; removed after the test. */
export async function tempDir(t, prefix = 'mergeproof test ') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Map used by the parser-level tests. */
export function testMapping(overrides = {}) {
  return parseMapping(
    JSON.stringify({
      idColumn: 'ID',
      idLabel: 'Record:',
      endMarker: 'END RECORD',
      fields: [
        { label: 'Name:', column: 'Name' },
        { label: 'City:', column: 'City' },
      ],
      ...overrides,
    }),
  );
}

export function pageText(...lines) {
  return `${lines.join('\n')}\n`;
}

/** Run the real CLI in a child process. Resolves with { code, stdout, stderr }. */
export function runCli(args, { env = process.env, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { env, cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code: error ? error.code : 0, stdout, stderr });
      },
    );
  });
}

export async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export function nonEmptyLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
