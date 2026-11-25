#!/usr/bin/env node
// Writes the synthetic sample job: node fixtures/generate.js [output-directory]
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeSamples } from './samples.js';

const USAGE = 'Usage: node fixtures/generate.js [output-directory]   (default: samples)';

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    options: { help: { type: 'boolean', short: 'h' } },
    strict: true,
    allowPositionals: true,
  });
} catch (error) {
  process.stderr.write(`generate: error: ${error.message}\n${USAGE}\n`);
  process.exitCode = 2;
}

if (parsed && parsed.values.help) {
  process.stdout.write(`${USAGE}\n`);
} else if (parsed && parsed.positionals.length > 1) {
  process.stderr.write(`generate: error: expected at most one output directory\n${USAGE}\n`);
  process.exitCode = 2;
} else if (parsed) {
  const outDir = resolve(parsed.positionals[0] ?? 'samples');
  const paths = await writeSamples(outDir);
  const show = (path) => {
    const rel = relative(process.cwd(), path) || '.';
    return /[^\w./-]/.test(rel) ? `'${rel.replaceAll("'", "'\\''")}'` : rel;
  };
  process.stdout.write(
    [
      `Wrote synthetic sample files to ${show(outDir)}:`,
      ...Object.values(paths).map((path) => `  ${show(path)}`),
      '',
      'Clean proof (expect exit 0):',
      `  node bin/mergeproof.js --csv ${show(paths.csv)} --map ${show(paths.map)} --pdf ${show(paths.cleanPdf)}`,
      'Broken proof (expect exit 1):',
      `  node bin/mergeproof.js --csv ${show(paths.csv)} --map ${show(paths.map)} --pdf ${show(paths.brokenPdf)}`,
      '',
    ].join('\n'),
  );
}
