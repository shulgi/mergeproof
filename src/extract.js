import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { InputError } from './errors.js';
import { formatBytes, statInputFile } from './files.js';

export const PDFTOTEXT = 'pdftotext';
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;
const q = (value) => JSON.stringify(value);

/**
 * Literal pdftotext arguments: UTF-8 output, LF line ends, reading-order text
 * (no -layout, so interior spaces come out single), output to stdout. The PDF
 * path is made absolute so it can never be mistaken for an option, and it is
 * passed as one argv entry, so spaces and shell characters are harmless.
 */
export function pdftotextArgs(pdfPath) {
  return ['-enc', 'UTF-8', '-eol', 'unix', resolve(pdfPath), '-'];
}

/**
 * Extract the text of every physical page. Element i is page i + 1.
 * pdftotext ends each page with a form feed, so an empty page yields ''.
 */
export async function extractPages(pdfPath, options = {}) {
  await statInputFile(pdfPath, 'PDF');
  const output = await runPdftotext(pdfPath, options);
  const pages = splitPages(new TextDecoder('utf-8').decode(output));
  if (pages.length === 0) {
    throw new InputError(`pdftotext returned no pages for ${pdfPath}; the PDF may be damaged.`);
  }
  return pages;
}

export function splitPages(text) {
  if (text === '') return [];
  const pages = text.split('\f');
  if (text.endsWith('\f')) pages.pop();
  return pages;
}

/**
 * Run pdftotext without a shell. Resolves with stdout as a Buffer.
 * Options exist for tests: `command`, `maxOutputBytes`, `timeoutMs`.
 */
export function runPdftotext(
  pdfPath,
  { command = PDFTOTEXT, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const args = pdftotextArgs(pdfPath);
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'buffer',
        maxBuffer: maxOutputBytes,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(describeFailure(error, stderr, { command, pdfPath, maxOutputBytes, timeoutMs }));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

function describeFailure(error, stderr, { command, pdfPath, maxOutputBytes, timeoutMs }) {
  if (error.code === 'ENOENT') {
    return new InputError(
      `pdftotext was not found (tried ${q(command)}). Install Poppler (macOS: brew install poppler; ` +
        'Debian/Ubuntu: sudo apt-get install poppler-utils) and make sure pdftotext is on PATH.',
      { cause: error },
    );
  }
  if (error.code === 'EACCES') {
    return new InputError(`pdftotext could not be started (permission denied): ${command}`, { cause: error });
  }
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new InputError(
      `pdftotext output for ${pdfPath} exceeded the ${formatBytes(maxOutputBytes)} limit, so MergeProof stopped. ` +
        'Proof the job in smaller PDF batches.',
      { cause: error },
    );
  }
  if (error.killed || error.signal) {
    return new InputError(
      `pdftotext did not finish within ${Math.round(timeoutMs / 1000)} seconds for ${pdfPath} and was stopped.`,
      { cause: error },
    );
  }
  const said = firstLines(stderr);
  const detail = said ? `\n  pdftotext said: ${said}` : '';
  if (typeof error.code === 'number') {
    const reason =
      {
        1: 'could not open the PDF (damaged, not a PDF, or password protected)',
        3: 'is not permitted to extract text from this PDF',
      }[error.code] ?? `failed with exit code ${error.code}`;
    return new InputError(`pdftotext ${reason}: ${pdfPath}${detail}`, { cause: error });
  }
  return new InputError(`pdftotext failed for ${pdfPath}: ${error.message}${detail}`, { cause: error });
}

function firstLines(stderr) {
  if (!stderr || stderr.length === 0) return '';
  const text = Buffer.isBuffer(stderr) ? new TextDecoder('utf-8').decode(stderr) : String(stderr);
  const joined = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' / ');
  return joined.length > 400 ? `${joined.slice(0, 400)}...` : joined;
}
