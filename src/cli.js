import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadCsv } from './csv.js';
import { EXIT, InputError, UsageError } from './errors.js';
import { extractPages } from './extract.js';
import { statInputFile } from './files.js';
import { loadMapping } from './mapping.js';
import { buildMarkers, parsePage } from './page.js';
import { reconcile } from './reconcile.js';
import { formatJson, formatJsonError, formatText } from './report.js';
import { formatExtractedText } from './show-text.js';

export const USAGE = `Usage: mergeproof --csv <file> --pdf <file> --map <file> [--json]
       mergeproof --show-text --pdf <file> [--map <file>]

Reconciles a merged native-text PDF with the CSV that supplied the merge.
Each page may hold at most one record: a line starting with the map's idLabel,
field lines starting with their labels, and a line that is exactly the endMarker.
Only text is compared: fonts, layout, images and barcodes are not checked.
Everything runs locally through Poppler's pdftotext; input files are only read.

Options:
  --csv <file>   UTF-8 CSV with a header row and a unique, nonempty ID column
  --pdf <file>   merged PDF with extractable text, at most one record per page
  --map <file>   JSON map: idColumn, idLabel, endMarker, fields [{label, column}]
  --json         print machine-readable JSON instead of the text report
  --show-text    print the text read from each PDF page instead of running a
                 proof; with --map, mark label lines and show each page's result
  -h, --help     show this help
  --version      show the version

Exit status: 0 clean proof, 1 findings, 2 unusable invocation or input.
--show-text exits 0 when the PDF could be read, otherwise 2.`;

const OPTIONS = {
  csv: { type: 'string' },
  pdf: { type: 'string' },
  map: { type: 'string' },
  json: { type: 'boolean' },
  'show-text': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
};
const FILE_OPTIONS = ['csv', 'pdf', 'map'];
const BASE_OPTIONS = Object.freeze({ help: false, version: false, showText: false, json: false });

export function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false, tokens: true });
  } catch (error) {
    throw new UsageError(error.message, { cause: error });
  }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new UsageError(`--${token.name} was given more than once.`);
    seen.add(token.name);
  }

  const { values } = parsed;
  if (values.help || values.version) {
    return { ...BASE_OPTIONS, help: Boolean(values.help), version: Boolean(values.version) };
  }
  if (values['show-text']) return showTextOptions(values);

  const missing = FILE_OPTIONS.filter((name) => values[name] === undefined);
  if (missing.length > 0) {
    const list = missing.map((name) => `--${name} <file>`).join(', ');
    throw new UsageError(`Missing required ${missing.length === 1 ? 'option' : 'options'}: ${list}.`);
  }
  requirePaths(values, FILE_OPTIONS);
  return { ...BASE_OPTIONS, csv: values.csv, pdf: values.pdf, map: values.map, json: Boolean(values.json) };
}

/** --show-text reads only the PDF and, optionally, the map. */
function showTextOptions(values) {
  const conflicts = ['csv', 'json'].filter((name) => values[name] !== undefined);
  if (conflicts.length > 0) {
    const list = conflicts.map((name) => `--${name}`).join(' or ');
    throw new UsageError(`--show-text cannot be combined with ${list}; it reads only --pdf and, optionally, --map.`);
  }
  if (values.pdf === undefined) throw new UsageError('--show-text needs --pdf <file>.');
  requirePaths(values, ['pdf', 'map']);
  return { ...BASE_OPTIONS, showText: true, pdf: values.pdf, map: values.map ?? null };
}

function requirePaths(values, names) {
  for (const name of names) {
    if (values[name] !== undefined && values[name].trim() === '') {
      throw new UsageError(`--${name} needs a file path.`);
    }
  }
}

/** Check every input path up front so all missing or unreadable files are reported together. */
async function checkInputFiles(entries) {
  const problems = [];
  for (const [what, path] of entries) {
    try {
      await statInputFile(path, what);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      problems.push(error.message);
    }
  }
  if (problems.length > 0) throw new InputError(problems.join('\n'));
}

/**
 * Run one proof. Throws InputError for anything that makes the proof unusable;
 * otherwise returns the reconciliation result (status 'pass' or 'fail').
 * `extract` options are forwarded to extractPages (used by tests).
 */
export async function runProof({ csv, pdf, map }, { extract } = {}) {
  await checkInputFiles([
    ['CSV', csv],
    ['PDF', pdf],
    ['Map', map],
  ]);

  const mapping = await loadMapping(map);
  const table = await loadCsv(csv, mapping);
  const texts = await extractPages(pdf, extract);
  const markers = buildMarkers(mapping);
  const pages = texts.map((text) => parsePage(text, mapping, markers));
  return { ...reconcile({ csv: table, pages, mapping }), inputs: { csv, pdf, map } };
}

/** Extract the PDF and return the --show-text listing. Throws InputError like runProof. */
export async function runShowText({ pdf, map = null }, { extract } = {}) {
  await checkInputFiles(map ? [['PDF', pdf], ['Map', map]] : [['PDF', pdf]]);
  const mapping = map ? await loadMapping(map) : null;
  const texts = await extractPages(pdf, extract);
  return formatExtractedText(texts, { pdf, mapping });
}

export function readVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return String(pkg.version);
}

/** Returns the exit code; never calls process.exit, so piped output is flushed. */
export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const json = argv.includes('--json');
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      io.stdout.write(`${USAGE}\n`);
      return EXIT.PASS;
    }
    if (options.version) {
      io.stdout.write(`${readVersion()}\n`);
      return EXIT.PASS;
    }
    if (options.showText) {
      io.stdout.write(await runShowText(options));
      return EXIT.PASS;
    }
    const result = await runProof(options);
    io.stdout.write(options.json ? formatJson(result) : formatText(result));
    return result.status === 'pass' ? EXIT.PASS : EXIT.FINDINGS;
  } catch (error) {
    const known = error instanceof InputError;
    const kind = error instanceof UsageError ? 'usage' : known ? 'input' : 'internal';
    const message = known ? error.message : `internal error: ${error?.stack ?? String(error)}`;
    if (json) {
      io.stdout.write(formatJsonError(kind, message));
    } else {
      const hint = kind === 'usage' ? '\nRun "mergeproof --help" for usage.' : '';
      io.stderr.write(`mergeproof: error: ${message}${hint}\n`);
    }
    return EXIT.INPUT;
  }
}

export async function run(argv = process.argv.slice(2)) {
  const crash = (error) => {
    try {
      process.stderr.write(`mergeproof: internal error: ${error?.stack ?? String(error)}\n`);
    } finally {
      process.exit(EXIT.INPUT);
    }
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
  process.stdout.on('error', (error) => {
    if (error?.code !== 'EPIPE') crash(error);
  });
  process.exitCode = await main(argv, { stdout: process.stdout, stderr: process.stderr });
}
