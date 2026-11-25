import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from '../src/csv.js';
import { buildMarkers, parsePage } from '../src/page.js';
import { reconcile } from '../src/reconcile.js';
import { COMBINING_DIAERESIS, O_DIAERESIS, pageText, testMapping } from './helpers.js';

const mapping = testMapping();
const markers = buildMarkers(mapping);
const pages = (...texts) => texts.map((text) => parsePage(text, mapping, markers));
const record = (id, name, ...cityLines) =>
  pageText('Letterhead', `Record: ${id}`, `Name: ${name}`, `City: ${cityLines[0]}`, ...cityLines.slice(1), 'END RECORD');

// CSV IDs: "00042", "A 7" (interior space) and an NFD "Ö-1"; a quoted multiline City.
const csv = parseCsv(
  'ID,Name,City\n' +
    '00042,"Lovelace, Ada",London\n' +
    '"A 7",Grace Hopper,"New\nYork"\n' +
    `O${COMBINING_DIAERESIS}-1,Jürgen Weiß,Zürich\n`,
  mapping,
);

test('a clean proof passes when PDF order differs from CSV order and a cover page has no record', () => {
  const result = reconcile({
    csv,
    mapping,
    pages: pages(
      pageText('Cover page'),
      record(`${O_DIAERESIS}-1`, 'Jürgen Weiß', 'Zürich'),
      record('A 7', 'Grace  Hopper', 'New', 'York'),
      record('00042', 'Lovelace, Ada', 'London'),
    ),
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.summary.findings, 0);
  assert.equal(result.summary.verifiedRecords, 3);
  assert.equal(result.summary.recordPages, 3);
  assert.deepEqual(result.pagesWithoutRecord, [1]);
  assert.deepEqual(
    [result.pageIssues, result.fieldMismatches, result.duplicateIds, result.unknownIds, result.missingIds],
    [[], [], [], [], []],
  );
});

test('a broken proof locates every kind of finding by physical page', () => {
  const result = reconcile({
    csv,
    mapping,
    pages: pages(
      record('00042', 'Lovelace, Ada', 'Londn'),
      pageText('Record: A 7', 'Name: Grace Hopper', 'END RECORD'),
      record('00042', 'Lovelace, Ada', 'London'),
      record('X-1', 'Nobody', 'Nowhere'),
      '',
      pageText(`Record: ${O_DIAERESIS}-1`, 'Name: Jürgen Weiß', 'City: Zürich'),
    ),
  });
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.fieldMismatches, [
    {
      page: 1,
      id: '00042',
      column: 'City',
      label: 'City:',
      expected: 'London',
      extracted: 'Londn',
      problem: 'value-differs',
    },
    {
      page: 2,
      id: 'A 7',
      column: 'City',
      label: 'City:',
      expected: 'New York',
      extracted: null,
      problem: 'label-missing',
    },
  ]);
  assert.deepEqual(result.duplicateIds, [{ id: '00042', pages: [1, 3], inCsv: true }]);
  assert.deepEqual(result.unknownIds, [{ page: 4, id: 'X-1' }]);
  assert.deepEqual(
    result.pageIssues.map(({ page, kind, ids }) => ({ page, kind, ids })),
    [
      { page: 5, kind: 'unreadable', ids: [] },
      { page: 6, kind: 'invalid-boundary', ids: [`${O_DIAERESIS}-1`] },
    ],
  );
  assert.deepEqual(result.missingIds, [{ id: `${O_DIAERESIS}-1`, csvRow: 3, seenOnInvalidPages: [6] }]);
  assert.equal(result.summary.verifiedRecords, 0);
  assert.equal(result.summary.findings, 2 + 1 + 1 + 2 + 1);
});

test('IDs match literally: no leading-zero, case or whitespace folding', () => {
  const result = reconcile({
    csv,
    mapping,
    pages: pages(
      record('42', 'Lovelace, Ada', 'London'),
      record('a 7', 'Grace Hopper', 'New York'),
      record('A  7', 'Grace Hopper', 'New York'),
      record(`${O_DIAERESIS}-1`, 'Jürgen Weiß', 'Zürich'),
    ),
  });
  assert.deepEqual(
    result.unknownIds.map((entry) => entry.id),
    ['42', 'a 7', 'A  7'],
  );
  assert.deepEqual(
    result.missingIds.map((entry) => entry.id),
    ['00042', 'A 7'],
  );
  assert.equal(result.summary.verifiedRecords, 1);
});

test('hints explain a proof where no record could be read, and are absent otherwise', () => {
  const blank = reconcile({ csv, mapping, pages: pages('', '\n') });
  assert.equal(blank.hints.length, 1);
  assert.match(blank.hints[0], /^No page has extractable text\./);

  const unlabelled = reconcile({ csv, mapping, pages: pages(pageText('Cover'), '', pageText('ID 00042', 'name: x')) });
  assert.equal(unlabelled.hints.length, 1);
  assert.match(unlabelled.hints[0], /^None of the map's labels start a line on any page/);
  assert.match(unlabelled.hints[0], /idLabel is "Record:"/);
  assert.match(unlabelled.hints[0], /mergeproof --show-text --pdf <file> --map <file>/);
  assert.equal(unlabelled.status, 'fail', 'a hint never turns missing IDs into a pass');

  const normal = reconcile({ csv, mapping, pages: pages(pageText('Cover'), record('00042', 'Lovelace, Ada', 'London')) });
  assert.deepEqual(normal.hints, []);

  const boundaryOnly = reconcile({ csv, mapping, pages: pages(pageText('Name: stray label')) });
  assert.deepEqual(boundaryOnly.hints, [], 'a page issue already explains the problem');
});

test('a duplicate page still has its fields checked, and a duplicate unknown ID is marked', () => {
  const result = reconcile({
    csv,
    mapping,
    pages: pages(
      record('00042', 'Lovelace, Ada', 'London'),
      record('00042', 'Ada Lovelace', 'London'),
      record('Z', 'n', 'c'),
      record('Z', 'n', 'c'),
    ),
  });
  assert.deepEqual(
    result.fieldMismatches.map((entry) => [entry.page, entry.column, entry.extracted]),
    [[2, 'Name', 'Ada Lovelace']],
  );
  assert.deepEqual(result.duplicateIds, [
    { id: '00042', pages: [1, 2], inCsv: true },
    { id: 'Z', pages: [3, 4], inCsv: false },
  ]);
});
