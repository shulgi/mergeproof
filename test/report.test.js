import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from '../src/csv.js';
import { buildMarkers, parsePage } from '../src/page.js';
import { reconcile } from '../src/reconcile.js';
import { formatJson, formatJsonError, formatPageList, formatText } from '../src/report.js';
import { pageText, testMapping } from './helpers.js';

const mapping = testMapping();
const markers = buildMarkers(mapping);
const csv = parseCsv('ID,Name,City\n001,Ada,Oslo\n002,Grace,Bergen\n003,Linus,Turku\n', mapping);
const run = (...texts) => ({
  ...reconcile({ csv, mapping, pages: texts.map((text) => parsePage(text, mapping, markers)) }),
  inputs: { csv: 'in.csv', pdf: 'in.pdf', map: 'map.json' },
});
const page = (id, name, city) => pageText(`Record: ${id}`, `Name: ${name}`, `City: ${city}`, 'END RECORD');

test('formatPageList compresses runs of three or more pages', () => {
  assert.equal(formatPageList([]), '');
  assert.equal(formatPageList([4]), '4');
  assert.equal(formatPageList([4, 5]), '4, 5');
  assert.equal(formatPageList([1, 2, 3, 5, 7, 8, 10, 11, 12, 13]), '1-3, 5, 7, 8, 10-13');
});

test('text report for a clean proof is short and says PASS', () => {
  const text = formatText(run(pageText('Cover'), page('003', 'Linus', 'Turku'), page('001', 'Ada', 'Oslo'), page('002', 'Grace', 'Bergen')));
  assert.equal(
    text,
    [
      'MergeProof PASS: 0 findings',
      '  4 pages, 3 CSV rows, 3 records verified (2 fields each)',
      '',
      'Pages without a record (not findings): 1',
      '',
    ].join('\n'),
  );
});

test('text report for a broken proof lists each finding with page, ID, expected and found values', () => {
  const text = formatText(
    run(
      page('001', 'Ada', 'Oslo, Norway'),
      pageText('Record: 002', 'Name: Grace', 'END RECORD'),
      page('002', 'Grace', 'Bergen'),
      page('XYZ', 'Nobody', 'Nowhere'),
      '',
      pageText('Record: 003', 'Name: Linus'),
    ),
  );
  const expectedLines = [
    'MergeProof FAIL: 7 findings',
    '  6 pages, 3 CSV rows, 0 records verified (2 fields each)',
    'Page issues (2)',
    '  page 5: unreadable - no extractable text (blank page, scanned image or outlined text)',
    '  page 6: invalid boundary - end marker "END RECORD" not found after "Record:" (ID "003")',
    'Field mismatches (2)',
    '  page 1, ID "001", City: expected "Oslo", found "Oslo, Norway"',
    '  page 2, ID "002", City: expected "Bergen", but label "City:" is not in the record block',
    'Duplicate PDF IDs (1)',
    '  ID "002" on pages 2, 3',
    'Unknown PDF IDs (1)',
    '  page 4: ID "XYZ" is not in the CSV',
    'Missing CSV IDs (1)',
    '  ID "003" (CSV data row 3) was not verified on any page; seen on unverified page 6',
  ];
  const lines = text.split('\n');
  for (const line of expectedLines) assert.ok(lines.includes(line), `missing line: ${line}\n---\n${text}`);
});

test('JSON report is valid JSON with status, exit code, summary and every finding list', () => {
  const report = JSON.parse(formatJson(run(page('001', 'Ada', 'Oslo'), page('999', 'X', 'Y'))));
  assert.equal(report.tool, 'mergeproof');
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, 'fail');
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.inputs, { csv: 'in.csv', pdf: 'in.pdf', map: 'map.json' });
  assert.equal(report.summary.findings, 3);
  assert.deepEqual(report.unknownIds, [{ page: 2, id: '999' }]);
  assert.deepEqual(
    report.missingIds.map((entry) => entry.id),
    ['002', '003'],
  );
  for (const key of ['pageIssues', 'fieldMismatches', 'duplicateIds', 'pagesWithoutRecord']) {
    assert.ok(Array.isArray(report[key]), key);
  }
});

test('hints are printed last in the text report and listed in JSON', () => {
  const result = run(pageText('Cover only'));
  const text = formatText(result);
  assert.match(text, /\n\nHint: None of the map's labels start a line on any page[^\n]*\n$/);
  assert.equal(JSON.parse(formatJson(result)).hints.length, 1);
  assert.deepEqual(JSON.parse(formatJson(run(page('001', 'Ada', 'Oslo')))).hints, []);
});

test('JSON error output is distinct from proof results', () => {
  const report = JSON.parse(formatJsonError('input', 'CSV file not found: x.csv'));
  assert.deepEqual(report, {
    tool: 'mergeproof',
    schemaVersion: 1,
    status: 'error',
    exitCode: 2,
    error: { kind: 'input', message: 'CSV file not found: x.csv' },
  });
});
