import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMapping } from '../src/mapping.js';
import { buildMarkers, matchMarker, parsePage } from '../src/page.js';
import {
  COMBINING_ACUTE,
  COMBINING_DIAERESIS,
  COMBINING_GRAVE,
  E_ACUTE,
  E_GRAVE,
  NBSP,
  O_DIAERESIS,
  pageText,
  testMapping,
} from './helpers.js';

const mapping = testMapping();
const parse = (...lines) => parsePage(pageText(...lines), mapping);

test('reads inline values and ignores text before the start label and after the end marker', () => {
  const result = parse(
    'Studio letterhead',
    '',
    'Record: 00042',
    'Name: Ada  Lovelace',
    'City: Zürich',
    'END RECORD',
    'Page footer',
  );
  assert.deepEqual(result, { status: 'record', id: '00042', fields: ['Ada Lovelace', 'Zürich'] });
});

test('reads following-line and multiline values up to the next label or the end marker', () => {
  const result = parse('Record:', '  A 7  ', 'Name:', 'Grace', '', 'Hopper', 'City: New', 'York', 'END RECORD');
  assert.deepEqual(result, { status: 'record', id: 'A 7', fields: ['Grace Hopper', 'New York'] });
});

test('accepts fields in any order and an empty value for a present label', () => {
  const result = parse('Record: 1', 'City:', 'Name: Ada', 'END RECORD');
  assert.deepEqual(result, { status: 'record', id: '1', fields: ['Ada', ''] });
});

test('reports a missing field label in a bounded block as null', () => {
  assert.deepEqual(parse('Record: 1', 'Name: Ada', 'END RECORD'), {
    status: 'record',
    id: '1',
    fields: ['Ada', null],
  });
});

test('keeps ID case, leading zeros and interior whitespace', () => {
  assert.equal(parse('Record:  Ab  0 07 ', 'END RECORD').id, 'Ab  0 07');
});

test('normalizes page lines to NFC before matching labels and reading values', () => {
  const nfcMapping = testMapping({ fields: [{ label: `Caf${E_ACUTE}:`, column: 'Name' }] });
  const text = pageText(
    `Record: O${COMBINING_DIAERESIS}-1`,
    `Cafe${COMBINING_ACUTE}: Cre${COMBINING_GRAVE}me`,
    'END RECORD',
  );
  assert.deepEqual(parsePage(text, nfcMapping), {
    status: 'record',
    id: `${O_DIAERESIS}-1`,
    fields: [`Cr${E_GRAVE}me`],
  });
});

test('flags a page with no extractable text as unreadable', () => {
  for (const text of ['', '\n', `  \n\t\n ${NBSP} \n`]) {
    const result = parsePage(text, mapping);
    assert.equal(result.status, 'issue');
    assert.equal(result.kind, 'unreadable');
    assert.deepEqual(result.ids, []);
  }
});

test('treats a page with text but no labels as a page without a record', () => {
  assert.deepEqual(parse('Cover page', 'record: 1 (lower case is not the label)'), { status: 'no-record' });
});

test('flags field labels or an end marker without the start label as an invalid boundary', () => {
  const result = parse('Name: Ada', 'City: Oslo', 'END RECORD');
  assert.equal(result.kind, 'invalid-boundary');
  assert.match(
    result.message,
    /end marker "END RECORD" and field labels "Name:", "City:" but no record start label "Record:"/,
  );
});

test('flags a missing end marker as an invalid boundary and keeps the seen ID', () => {
  const result = parse('Record: 00042', 'Name: Ada', 'City: Oslo', 'footer');
  assert.equal(result.kind, 'invalid-boundary');
  assert.match(result.message, /end marker "END RECORD" not found/);
  assert.deepEqual(result.ids, ['00042']);
});

test('flags an end marker before the start label as an invalid boundary', () => {
  const result = parse('END RECORD', 'Record: 1', 'Name: Ada', 'City: Oslo');
  assert.equal(result.kind, 'invalid-boundary');
  assert.match(result.message, /appears before "Record:"/);
});

test('flags a field label outside the record block as an invalid boundary', () => {
  const result = parse('Record: 1', 'Name: Ada', 'END RECORD', 'City: Oslo');
  assert.equal(result.kind, 'invalid-boundary');
  assert.match(result.message, /field label "City:" outside the record block/);
});

test('flags multiple IDs, end markers or repeated labels as ambiguous', () => {
  const twoIds = parse('Record: 1', 'Name: Ada', 'Record: 2', 'City: Oslo', 'END RECORD');
  assert.equal(twoIds.kind, 'ambiguous');
  assert.match(twoIds.message, /"Record:" appears 2 times/);
  assert.deepEqual(twoIds.ids, ['1', '2']);

  const twoEnds = parse('Record: 1', 'Name: Ada', 'City: Oslo', 'END RECORD', 'END RECORD');
  assert.equal(twoEnds.kind, 'ambiguous');
  assert.match(twoEnds.message, /end marker "END RECORD" appears 2 times/);

  const repeated = parse('Record: 1', 'Name: Ada', 'Name: Grace', 'City: Oslo', 'END RECORD');
  assert.equal(repeated.kind, 'ambiguous');
  assert.match(repeated.message, /field label "Name:" appears 2 times/);
});

test('flags an empty ID or an ID spanning several lines as ambiguous', () => {
  const empty = parse('Record:', 'Name: Ada', 'City: Oslo', 'END RECORD');
  assert.equal(empty.kind, 'ambiguous');
  assert.match(empty.message, /has no ID value/);

  const split = parse('Record: AB', 'CD', 'Name: Ada', 'City: Oslo', 'END RECORD');
  assert.equal(split.kind, 'ambiguous');
  assert.match(split.message, /spans 2 lines/);
  assert.deepEqual(split.ids, ['AB']);
});

test('labels ending in a letter need whitespace after them; the longest label wins', () => {
  const wordMapping = parseMapping(
    JSON.stringify({
      idColumn: 'ID',
      idLabel: 'ID',
      endMarker: 'END',
      fields: [
        { label: 'Name', column: 'Name' },
        { label: 'Name 2', column: 'Name 2' },
      ],
    }),
  );
  const text = pageText('IDENTITY header', 'ID 7', 'Name Ada', 'Nameless line', 'Name 2 Bob', 'ENDING soon', 'END');
  assert.deepEqual(parsePage(text, wordMapping), {
    status: 'record',
    id: '7',
    fields: ['Ada Nameless line', 'Bob ENDING soon'],
  });
});

test('labels ending in punctuation match without a following space; labels are case-sensitive', () => {
  const markers = buildMarkers(mapping);
  assert.equal(matchMarker('Name:Ada', markers)?.kind, 'field');
  assert.equal(matchMarker('Record:7', markers)?.kind, 'id');
  assert.equal(matchMarker('END RECORD', markers)?.kind, 'end');
  assert.equal(matchMarker('END RECORDS', markers), null);
  assert.equal(matchMarker('name: Ada', markers), null);
});

test('the end marker must be the whole trimmed NFC line; a similar-looking footer is not a boundary', () => {
  const finished = testMapping({ endMarker: 'Record finished' });
  const markers = buildMarkers(finished);
  assert.equal(matchMarker('Record finished', markers)?.kind, 'end');
  assert.equal(matchMarker('Record finished maybe', markers), null);
  assert.equal(matchMarker('Record finished.', markers), null);
  // ID and field labels keep prefix matching.
  assert.equal(matchMarker('Record: 7', markers)?.kind, 'id');
  assert.equal(matchMarker('Name: Ada', markers)?.kind, 'field');

  const footerOnly = parsePage(pageText('Record: 1', 'Name: Ada', 'City: Oslo', 'Record finished maybe'), finished);
  assert.equal(footerOnly.kind, 'invalid-boundary');
  assert.match(footerOnly.message, /end marker "Record finished" not found/);
  assert.deepEqual(footerOnly.ids, ['1']);

  const inside = parsePage(
    pageText(
      'Record: 1',
      'Name: Ada',
      'City: Oslo',
      'Record finished maybe',
      '  Record finished  ',
      'Record finished soon',
    ),
    finished,
  );
  assert.deepEqual(inside, { status: 'record', id: '1', fields: ['Ada', 'Oslo Record finished maybe'] });

  const accented = testMapping({ endMarker: `Fin${E_ACUTE}` });
  assert.deepEqual(parsePage(pageText('Record: 1', 'Name: Ada', `  Fine${COMBINING_ACUTE} `), accented), {
    status: 'record',
    id: '1',
    fields: ['Ada', null],
  });
});
