import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPdf, encodeWinAnsi, pdfLiteral } from '../fixtures/pdf-writer.js';
import { brokenProofPages, cleanProofPages } from '../fixtures/samples.js';
import { COMBINING_ACUTE, cp, NBSP } from './helpers.js';

test('pdfLiteral escapes delimiters and backslashes', () => {
  assert.equal(pdfLiteral('Plain text 123'), '(Plain text 123)');
  assert.equal(pdfLiteral('a(b)c\\d'), '(a\\(b\\)c\\\\d)');
});

test('pdfLiteral writes WinAnsi bytes above 127 as 3-digit octal escapes', () => {
  // u-umlaut 0xFC = \374, euro 0x80 = \200, en dash 0x96 = \226, right quote 0x92 = \222
  assert.equal(pdfLiteral('Zürich €5 – O’Brien'), '(Z\\374rich \\2005 \\226 O\\222Brien)');
  assert.equal(pdfLiteral('(€7.25)'), '(\\(\\2007.25\\))');
});

test('encodeWinAnsi composes to NFC first and maps the 0x80-0x9F block', () => {
  assert.deepEqual(encodeWinAnsi(`e${COMBINING_ACUTE}`), [0xe9]);
  assert.equal(pdfLiteral(`Jose${COMBINING_ACUTE}`), '(Jos\\351)');
  assert.deepEqual(encodeWinAnsi('Ÿ€“”'), [0x9f, 0x80, 0x93, 0x94]);
});

test('encodeWinAnsi rejects characters it cannot represent exactly', () => {
  for (const text of ['Ω', cp(0x1f600), '\t', NBSP, cp(0x00ad)]) {
    assert.throws(() => encodeWinAnsi(text), /Cannot encode/);
  }
});

test('buildPdf writes exact cross-reference offsets, stream lengths and a trailer', () => {
  const pdf = buildPdf([['Hello (world)'], [], ['Page three']]);
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n%'));
  assert.ok(text.endsWith('%%EOF\n'));

  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
  assert.ok(header, 'startxref must point at the xref keyword');
  const count = Number(header[1]);
  assert.equal(count, 5 + 2 * 3 + 1);

  const tableStart = startxref + header[0].length;
  for (let n = 0; n < count; n += 1) {
    const entry = text.slice(tableStart + n * 20, tableStart + (n + 1) * 20);
    if (n === 0) {
      assert.equal(entry, '0000000000 65535 f \n');
      continue;
    }
    assert.match(entry, /^\d{10} 00000 n \n$/);
    const offset = Number(entry.slice(0, 10));
    assert.equal(text.slice(offset, offset + `${n} 0 obj\n`.length), `${n} 0 obj\n`);
  }
  assert.match(text.slice(tableStart + count * 20), /^trailer\n<< \/Size 12 \/Root 1 0 R \/Info 5 0 R \/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\] >>\n/);

  const streams = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
  assert.equal(streams.length, 3);
  for (const match of streams) {
    const start = match.index + match[0].length;
    const length = Number(match[1]);
    assert.equal(text.slice(start + length, start + length + 10), '\nendstream');
  }
  assert.ok(text.includes('(Hello \\(world\\)) Tj'));
  assert.ok(text.includes('/BaseFont /Courier /Encoding /WinAnsiEncoding'));
});

test('buildPdf output is ASCII after the binary header comment and is deterministic', () => {
  const pages = [['Zürich – O’Brien €1,250.00']];
  const pdf = buildPdf(pages);
  const headerLength = '%PDF-1.4\n'.length + 6;
  assert.ok(pdf.subarray(headerLength).every((byte) => byte < 0x80));
  assert.ok(pdf.equals(buildPdf(pages)));
});

test('buildPdf rejects lines that would leave the page and too many lines', () => {
  assert.throws(() => buildPdf([['x'.repeat(85)]]), /longer than 84 characters/);
  assert.throws(() => buildPdf([Array(60).fill('line')]), /more than \d+ lines/);
  assert.throws(() => buildPdf([]), /at least one page/);
});

test('the sample pages are encodable and keep their documented shape', () => {
  assert.equal(cleanProofPages().length, 7);
  assert.equal(brokenProofPages().length, 9);
  assert.doesNotThrow(() => buildPdf(cleanProofPages()));
  assert.doesNotThrow(() => buildPdf(brokenProofPages()));
});
