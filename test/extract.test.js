import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildPdf } from '../fixtures/pdf-writer.js';
import { extractPages, pdftotextArgs, splitPages } from '../src/extract.js';
import { nonEmptyLines, tempDir } from './helpers.js';

// These tests run the real Poppler pdftotext, a documented prerequisite.

const PAGE_ONE = [
  'Plain ASCII 0123',
  'Zürich – O’Brien pays €1,250.00',
  'Parens (kept) and back\\slash',
  'Ångström, Weiß, “quoted”, naïve',
];

test('splitPages drops only the trailing form feed, so blank pages keep their place', () => {
  assert.deepEqual(splitPages(''), []);
  assert.deepEqual(splitPages('\f'), ['']);
  assert.deepEqual(splitPages('a\n\f\fc\n\f'), ['a\n', '', 'c\n']);
  assert.deepEqual(splitPages('no trailing feed'), ['no trailing feed']);
});

test('pdftotext receives literal arguments with an absolute PDF path as one entry', () => {
  const args = pdftotextArgs("odd dir/-layout; $(echo no) 'x'.pdf");
  assert.deepEqual(args.slice(0, 4), ['-enc', 'UTF-8', '-eol', 'unix']);
  assert.equal(args.length, 6);
  assert.equal(args[4], resolve("odd dir/-layout; $(echo no) 'x'.pdf"));
  assert.ok(isAbsolute(args[4]));
  assert.equal(args[5], '-');
});

test('real extraction returns UTF-8 text, escaped literals and physical pages', async (t) => {
  const dir = await tempDir(t);
  const pdfPath = join(dir, 'escape check.pdf');
  await writeFile(pdfPath, buildPdf([PAGE_ONE, [], ['Third page']]));

  const pages = await extractPages(pdfPath);
  assert.equal(pages.length, 3);
  assert.deepEqual(nonEmptyLines(pages[0]), PAGE_ONE);
  assert.equal(pages[1].trim(), '');
  assert.deepEqual(nonEmptyLines(pages[2]), ['Third page']);
});

test('a damaged PDF is an input error', async (t) => {
  const dir = await tempDir(t);
  const pdfPath = join(dir, 'damaged.pdf');
  await writeFile(pdfPath, '%PDF-1.4\n% damaged on purpose: no objects, no cross-reference table\n');
  await assert.rejects(extractPages(pdfPath), { name: 'InputError', message: /pdftotext/ });
});

test('a missing pdftotext binary is an input error with install advice', async (t) => {
  const dir = await tempDir(t);
  const pdfPath = join(dir, 'ok.pdf');
  await writeFile(pdfPath, buildPdf([['Hello']]));
  await assert.rejects(extractPages(pdfPath, { command: join(dir, 'no-such-pdftotext') }), {
    name: 'InputError',
    message: /pdftotext was not found.*Install Poppler/s,
  });
});

test('output beyond the limit stops with a clear error', async (t) => {
  const dir = await tempDir(t);
  const pdfPath = join(dir, 'big.pdf');
  await writeFile(pdfPath, buildPdf([PAGE_ONE, PAGE_ONE]));
  await assert.rejects(extractPages(pdfPath, { maxOutputBytes: 16 }), {
    name: 'InputError',
    message: /exceeded the 16 bytes limit/,
  });
});

test('a missing PDF file is an input error before pdftotext runs', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(extractPages(join(dir, 'missing file.pdf'), { command: join(dir, 'never-run') }), {
    name: 'InputError',
    message: /PDF file not found/,
  });
});
