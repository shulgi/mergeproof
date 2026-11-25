import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeId, normalizeValue, stripBom, trimNfc } from '../src/normalize.js';
import { BOM, COMBINING_ACUTE, COMBINING_DIAERESIS, cp, E_ACUTE, NBSP, O_DIAERESIS } from './helpers.js';

test('IDs keep leading zeros, case and interior whitespace; only edges are trimmed', () => {
  assert.equal(normalizeId('  00042 '), '00042');
  assert.equal(normalizeId(`\t${NBSP}A  7\n`), 'A  7');
  assert.notEqual(normalizeId('A-7'), normalizeId('a-7'));
  assert.notEqual(normalizeId('00042'), normalizeId('42'));
  assert.notEqual(normalizeId('A 7'), normalizeId('A  7'));
});

test('IDs and values compare equal across NFD and NFC forms', () => {
  const nfd = `Jose${COMBINING_ACUTE} O${COMBINING_DIAERESIS}-17`;
  const nfc = `Jos${E_ACUTE} ${O_DIAERESIS}-17`;
  assert.notEqual(nfd, nfc);
  assert.equal(nfd.length, nfc.length + 2);
  assert.equal(normalizeId(nfd), nfc);
  assert.equal(normalizeValue(nfd), nfc);
  assert.equal(trimNfc(` ${nfd} `), nfc);
});

test('values collapse every kind of visual whitespace to single spaces', () => {
  const emSpace = cp(0x2003);
  const narrowNoBreak = cp(0x202f);
  assert.equal(
    normalizeValue(`  12 Rue\r\nde la\tPaix${NBSP}${emSpace}Apt${narrowNoBreak}4  `),
    '12 Rue de la Paix Apt 4',
  );
  assert.equal(normalizeValue('Line 1\n\n\nLine 2'), 'Line 1 Line 2');
  assert.equal(normalizeValue(' \n\t '), '');
});

test('values keep punctuation, case and digits, with no compatibility folding', () => {
  assert.equal(normalizeValue('€1,250.00 (Net) – O’Brien'), '€1,250.00 (Net) – O’Brien');
  assert.notEqual(normalizeValue('Studio'), normalizeValue('studio'));
  assert.notEqual(normalizeValue('1,250.00'), normalizeValue('1250.00'));
  const fiLigature = cp(0xfb01);
  assert.equal(normalizeValue(`${fiLigature}le`), `${fiLigature}le`);
  assert.notEqual(normalizeValue(cp(0xff11, 0xff12)), '12');
});

test('null and undefined normalize to an empty string; stripBom removes one leading BOM', () => {
  assert.equal(normalizeId(undefined), '');
  assert.equal(normalizeValue(null), '');
  assert.equal(stripBom(`${BOM}ID,Name`), 'ID,Name');
  assert.equal(stripBom('ID,Name'), 'ID,Name');
});
