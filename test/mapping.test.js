import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadMapping, parseMapping } from '../src/mapping.js';
import { BOM, COMBINING_ACUTE, E_ACUTE, tempDir } from './helpers.js';

const VALID = {
  idColumn: 'ID',
  idLabel: 'Record:',
  endMarker: 'END',
  fields: [
    { label: 'Name:', column: 'Name' },
    { label: 'City:', column: 'City' },
  ],
};

const parse = (value) => parseMapping(typeof value === 'string' ? value : JSON.stringify(value));
const fails = (value, pattern) => assert.throws(() => parse(value), { name: 'InputError', message: pattern });

test('accepts the supported shape and normalizes text with NFC and edge trimming', () => {
  const mapping = parse({
    ...VALID,
    idColumn: '  ID ',
    fields: [{ label: ` Cafe${COMBINING_ACUTE}: `, column: `Caf${E_ACUTE}` }],
  });
  assert.deepEqual(mapping, {
    idColumn: 'ID',
    idLabel: 'Record:',
    endMarker: 'END',
    fields: [{ label: `Caf${E_ACUTE}:`, column: `Caf${E_ACUTE}` }],
  });
  assert.ok(Object.isFrozen(mapping));
});

test('accepts a UTF-8 BOM before the JSON', () => {
  assert.equal(parse(`${BOM}${JSON.stringify(VALID)}`).idLabel, 'Record:');
});

test('rejects invalid JSON and non-object roots', () => {
  fails('{not json', /not valid JSON/);
  fails('[]', /must be a JSON object/);
  fails('null', /must be a JSON object/);
  fails('"text"', /must be a JSON object/);
});

test('rejects unsupported keys, including typos and __proto__', () => {
  fails({ ...VALID, endmarker: 'END' }, /unsupported key "endmarker"/);
  fails('{"__proto__": {}, "idColumn": "ID"}', /unsupported key "__proto__"/);
  fails(
    { ...VALID, fields: [{ label: 'Name:', column: 'Name', fuzzy: true }] },
    /fields\[0\] has unsupported key "fuzzy"/,
  );
});

test('rejects missing, non-string, empty and multi-line values', () => {
  const { endMarker, ...withoutEnd } = VALID;
  assert.equal(endMarker, 'END');
  fails(withoutEnd, /missing "endMarker"/);
  fails({ ...VALID, idColumn: 5 }, /"idColumn" must be a string/);
  fails({ ...VALID, idLabel: '   ' }, /"idLabel" must not be empty/);
  fails({ ...VALID, idLabel: 'Record\nID:' }, /single line/);
  fails({ ...VALID, endMarker: 'END\tHERE' }, /single line/);
  fails({ ...VALID, fields: [{ label: `Name${String.fromCodePoint(0x2028)}x`, column: 'Name' }] }, /single line/);
  fails({ ...VALID, idLabel: 'x'.repeat(501) }, /longer than 500/);
});

test('rejects missing, empty or malformed field lists', () => {
  const { fields, ...withoutFields } = VALID;
  assert.equal(fields.length, 2);
  fails(withoutFields, /missing "fields"/);
  fails({ ...VALID, fields: [] }, /non-empty array/);
  fails({ ...VALID, fields: {} }, /non-empty array/);
  fails({ ...VALID, fields: ['Name:'] }, /fields\[0\] must be an object/);
  fails({ ...VALID, fields: [{ label: 'Name:' }] }, /fields\[0\] is missing "column"/);
  fails(
    { ...VALID, fields: Array.from({ length: 201 }, (_, i) => ({ label: `L${i}:`, column: 'C' })) },
    /limit is 200/,
  );
});

test('rejects labels that are not distinct from each other or from the markers', () => {
  fails(
    {
      ...VALID,
      fields: [
        { label: 'Name:', column: 'A' },
        { label: ' Name: ', column: 'B' },
      ],
    },
    /must be distinct/,
  );
  fails({ ...VALID, fields: [{ label: 'Record:', column: 'A' }] }, /repeats idLabel/);
  fails({ ...VALID, endMarker: 'Record:' }, /repeats idLabel/);
});

test('allows two labels for the same column and a field that reuses the ID column', () => {
  const mapping = parse({
    ...VALID,
    fields: [
      { label: 'Name:', column: 'Name' },
      { label: 'Signed:', column: 'Name' },
      { label: 'Ref:', column: 'ID' },
    ],
  });
  assert.equal(mapping.fields.length, 3);
});

test('loadMapping reports missing files and invalid UTF-8 as input errors', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(loadMapping(join(dir, 'missing map.json')), {
    name: 'InputError',
    message: /Map file not found/,
  });
  const latin1 = join(dir, 'latin1 map.json');
  await writeFile(latin1, Buffer.from([0x7b, 0x22, 0xe9, 0x22, 0x7d]));
  await assert.rejects(loadMapping(latin1), { name: 'InputError', message: /not valid UTF-8/ });
});
