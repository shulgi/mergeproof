import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCsv, parseCsv } from '../src/csv.js';
import { BOM, COMBINING_DIAERESIS, O_DIAERESIS, tempDir, testMapping } from './helpers.js';

const mapping = testMapping();
const fails = (text, pattern) => assert.throws(() => parseCsv(text, mapping), { name: 'InputError', message: pattern });

test('handles a BOM, CRLF rows, quoted commas, doubled quotes, multiline cells and UTF-8', () => {
  const text =
    `${BOM}ID,Name,City,Extra\r\n` +
    '00042,"Lovelace, Ada","Line 1\r\nLine 2",x\r\n' +
    '007,"Say ""hi""",Zürich,\r\n';
  const table = parseCsv(text, mapping);
  assert.deepEqual(table.header, ['ID', 'Name', 'City', 'Extra']);
  assert.deepEqual(
    table.rows.map((row) => [row.id, row.rowNumber, row.values]),
    [
      ['00042', 1, ['Lovelace, Ada', 'Line 1\r\nLine 2']],
      ['007', 2, ['Say "hi"', 'Zürich']],
    ],
  );
  assert.equal(table.byId.get('007').values[1], 'Zürich');
});

test('keeps IDs as strings: leading zeros, case and interior spaces survive; edges are trimmed', () => {
  const table = parseCsv('ID,Name,City\n 00042 ,a,b\nA  7,c,d\na  7,e,f\n', mapping);
  assert.deepEqual([...table.byId.keys()], ['00042', 'A  7', 'a  7']);
});

test('normalizes IDs to NFC, so decomposed and precomposed forms are the same ID', () => {
  const table = parseCsv(`ID,Name,City\nO${COMBINING_DIAERESIS}-1,a,b\n`, mapping);
  assert.deepEqual([...table.byId.keys()], [`${O_DIAERESIS}-1`]);
  fails(
    `ID,Name,City\nO${COMBINING_DIAERESIS}-1,a,b\n${O_DIAERESIS}-1,c,d\n`,
    new RegExp(`duplicate ID "${O_DIAERESIS}-1" \\(data rows 1, 2\\)`),
  );
});

test('matches header names after trimming and NFC', () => {
  const table = parseCsv(' ID ,Name , City\n1,a,b\n', mapping);
  assert.equal(table.rows[0].values[1], 'b');
});

test('skips rows whose cells are all blank but keeps data-row numbering', () => {
  const table = parseCsv('ID,Name,City\n,,\n  , ,\n3,a,b\n', mapping);
  assert.deepEqual(
    table.rows.map((row) => [row.id, row.rowNumber]),
    [['3', 3]],
  );
});

test('rejects blank and duplicate IDs with row numbers', () => {
  fails('ID,Name,City\n1,a,b\n ,c,d\n', /blank ID in data row 2/);
  fails('ID,Name,City\n1,a,b\n2,c,d\n1,e,f\n', /duplicate ID "1" \(data rows 1, 3\)/);
  fails('ID,Name,City\n1,a,b\n1 ,c,d\n,e,f\n', /blank ID in data row 3; duplicate ID "1"/);
});

test('treats IDs that differ only in case as different rows', () => {
  assert.equal(parseCsv('ID,Name,City\nab1,a,b\nAB1,c,d\n', mapping).rows.length, 2);
});

test('rejects malformed CSV: unclosed quotes and inconsistent column counts', () => {
  fails('ID,Name,City\n1,"unclosed,b\n', /Malformed CSV/);
  fails('ID,Name,City\n1,a\n', /Malformed CSV/);
});

test('rejects missing or repeated mapped columns', () => {
  fails('ID,Name\n1,a\n', /no column "City" \(map fields\[1\]\.column\)/);
  fails('ID,Name,City,City\n1,a,b,c\n', /"City" appears 2 times/);
  fails('Key,Name,City\n1,a,b\n', /no column "ID" \(map idColumn\)/);
});

test('rejects an empty file and a header without data rows', () => {
  fails('', /CSV is empty/);
  fails(`${BOM}\r\n`, /CSV is empty/);
  fails('ID,Name,City\r\n', /no data rows/);
  fails('ID,Name,City\n,,\n', /no data rows/);
});

test('loadCsv rejects files that are not UTF-8', async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, 'utf16 export.csv');
  await writeFile(path, Buffer.from(`${BOM}ID,Name,City\r\n1,a,b\r\n`, 'utf16le'));
  await assert.rejects(loadCsv(path, mapping), { name: 'InputError', message: /not valid UTF-8/ });
});
