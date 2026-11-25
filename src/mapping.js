import { InputError } from './errors.js';
import { readUtf8File } from './files.js';
import { stripBom, trimNfc } from './normalize.js';

export const MAX_MAP_BYTES = 1024 * 1024;
export const MAX_FIELDS = 200;
const MAX_TEXT_LENGTH = 500;
const TOP_LEVEL_KEYS = Object.freeze(['idColumn', 'idLabel', 'endMarker', 'fields']);
const FIELD_KEYS = Object.freeze(['label', 'column']);
// Control characters (including CR, LF, tab and NEL) and the Unicode line/paragraph separators.
const CONTROL_OR_LINE_BREAK = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const q = (value) => JSON.stringify(value);

/**
 * Load the hand-written JSON map. Supported shape (no other keys are accepted):
 *
 *   {
 *     "idColumn": "Member ID",           CSV header of the unique ID column
 *     "idLabel": "Member ID:",           line-start label that opens a record
 *     "endMarker": "END OF RECORD",      whole-line marker that closes it
 *     "fields": [ { "label": "Name:", "column": "Full Name" } ]
 *   }
 */
export async function loadMapping(path) {
  const text = await readUtf8File(path, 'Map', MAX_MAP_BYTES);
  return parseMapping(text);
}

export function parseMapping(text) {
  let data;
  try {
    data = JSON.parse(stripBom(text));
  } catch (error) {
    throw new InputError(`Map is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!isPlainObject(data)) {
    throw new InputError(`Map must be a JSON object with the keys ${TOP_LEVEL_KEYS.join(', ')}.`);
  }
  rejectUnknownKeys(data, TOP_LEVEL_KEYS, 'Map');

  const idColumn = readText(data, 'idColumn', 'Map', false);
  const idLabel = readText(data, 'idLabel', 'Map', true);
  const endMarker = readText(data, 'endMarker', 'Map', true);

  if (!Object.hasOwn(data, 'fields')) {
    throw new InputError('Map is missing "fields" (a list of {"label", "column"} objects).');
  }
  const rawFields = data.fields;
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw new InputError('Map "fields" must be a non-empty array of {"label", "column"} objects.');
  }
  if (rawFields.length > MAX_FIELDS) {
    throw new InputError(`Map "fields" has ${rawFields.length} entries; the limit is ${MAX_FIELDS}.`);
  }
  const fields = rawFields.map((entry, index) => {
    const where = `Map fields[${index}]`;
    if (!isPlainObject(entry)) {
      throw new InputError(`${where} must be an object with "label" and "column".`);
    }
    rejectUnknownKeys(entry, FIELD_KEYS, where);
    return Object.freeze({
      label: readText(entry, 'label', where, true),
      column: readText(entry, 'column', where, false),
    });
  });

  const seen = new Map();
  const markers = [
    ['idLabel', idLabel],
    ['endMarker', endMarker],
    ...fields.map((field, index) => [`fields[${index}].label`, field.label]),
  ];
  for (const [where, value] of markers) {
    if (seen.has(value)) {
      throw new InputError(
        `Map ${where} ${q(value)} repeats ${seen.get(value)}; idLabel, endMarker and field labels must be distinct.`,
      );
    }
    seen.set(value, where);
  }

  return Object.freeze({ idColumn, idLabel, endMarker, fields: Object.freeze(fields) });
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new InputError(
        `${where} has unsupported key ${q(key)}. Supported keys: ${allowed.map((k) => q(k)).join(', ')}.`,
      );
    }
  }
}

function readText(object, key, where, isLabel) {
  if (!Object.hasOwn(object, key)) {
    throw new InputError(`${where} is missing ${q(key)}.`);
  }
  const value = object[key];
  if (typeof value !== 'string') {
    throw new InputError(`${where} ${q(key)} must be a string.`);
  }
  const text = trimNfc(value);
  if (text === '') {
    throw new InputError(`${where} ${q(key)} must not be empty.`);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new InputError(`${where} ${q(key)} is longer than ${MAX_TEXT_LENGTH} characters.`);
  }
  if (isLabel && CONTROL_OR_LINE_BREAK.test(text)) {
    throw new InputError(
      `${where} ${q(key)} must be a single line without tabs or control characters; ` +
        'labels are matched at the start of one line.',
    );
  }
  return text;
}
