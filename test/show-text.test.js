import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatExtractedText } from '../src/show-text.js';
import { pageText, testMapping } from './helpers.js';

const mapping = testMapping();

test('without a map, each page lists its trimmed, non-blank lines', () => {
  const text = formatExtractedText([pageText('  Cover  ', '', 'Second line'), ''], { pdf: 'job.pdf' });
  assert.equal(
    text,
    [
      'MergeProof extracted text: job.pdf (2 pages)',
      'Lines are trimmed and NFC-normalized; blank lines are omitted. Add --map <file> to mark map labels.',
      '',
      '--- page 1 ---',
      '  Cover',
      '  Second line',
      '',
      '--- page 2 ---',
      '  (no extractable text)',
      '',
    ].join('\n'),
  );
});

test('with a map, label lines are tagged and each page header gives the parse result', () => {
  const text = formatExtractedText(
    [
      pageText('Letterhead', 'Record: 001', 'Name: Ada', 'City: Oslo', 'END RECORD'),
      pageText('Cover'),
      '',
      pageText('Record: 002', 'Name: Grace'),
    ],
    { pdf: 'job.pdf', mapping },
  );
  const lines = text.split('\n');
  const expected = [
    'MergeProof extracted text: job.pdf (4 pages)',
    '--- page 1: record "001" ---',
    '        Letterhead',
    '  [id]  Record: 001',
    '  [fld] Name: Ada',
    '  [fld] City: Oslo',
    '  [end] END RECORD',
    '--- page 2: no record ---',
    '        Cover',
    '--- page 3: unreadable - no extractable text (blank page, scanned image or outlined text) ---',
    '--- page 4: invalid boundary - end marker "END RECORD" not found after "Record:" ---',
  ];
  for (const line of expected) assert.ok(lines.includes(line), `missing line: ${line}\n---\n${text}`);
  assert.ok(!lines.includes('  (no extractable text)'), 'the unreadable header already explains page 3');
});

test('a lookalike end marker is not tagged, matching the parser', () => {
  const text = formatExtractedText([pageText('Record: 001', 'Name: Ada', 'City: Oslo', 'END RECORD maybe')], {
    pdf: 'job.pdf',
    mapping,
  });
  const lines = text.split('\n');
  assert.ok(lines.includes('        END RECORD maybe'), text);
  assert.ok(lines.includes('--- page 1: invalid boundary - end marker "END RECORD" not found after "Record:" ---'), text);
});
