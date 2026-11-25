import { parse } from 'csv-parse/sync';
import { InputError } from './errors.js';
import { readUtf8File } from './files.js';
import { normalizeId, stripBom, trimNfc } from './normalize.js';

export const MAX_CSV_BYTES = 256 * 1024 * 1024;
const MAX_LISTED = 10;
const MAX_HEADER_LISTED = 30;
const q = (value) => JSON.stringify(value);

export async function loadCsv(path, mapping) {
  const text = await readUtf8File(path, 'CSV', MAX_CSV_BYTES);
  return parseCsv(text, mapping);
}

/**
 * Parse comma-separated UTF-8 text with a header row. Quoted cells may contain
 * commas, doubled quotes and line breaks; a leading BOM is ignored. Cells stay
 * strings (no type casting), so "00042" keeps its leading zeros.
 *
 * Rows whose cells are all blank are skipped. A blank or repeated ID (after NFC
 * and edge trimming; case-sensitive) makes the CSV unusable.
 *
 * Returns { header, rows: [{ id, rowNumber, values }], byId } where `values`
 * follows mapping.fields order and `rowNumber` counts data rows after the header.
 */
export function parseCsv(text, mapping) {
  let records;
  try {
    records = parse(stripBom(text), {
      bom: true,
      columns: false,
      skip_empty_lines: true,
      relax_column_count: false,
      relax_quotes: false,
      trim: false,
    });
  } catch (error) {
    throw new InputError(`Malformed CSV: ${error.message}`, { cause: error });
  }
  if (records.length === 0) {
    throw new InputError('CSV is empty; expected a header row and at least one data row.');
  }

  const header = records[0].map((cell) => trimNfc(cell));
  const idIndex = columnIndex(header, mapping.idColumn, 'idColumn');
  const fieldIndexes = mapping.fields.map((field, index) =>
    columnIndex(header, field.column, `fields[${index}].column`),
  );

  const rows = [];
  const blankRows = [];
  const firstRowById = new Map();
  const duplicateRows = new Map();

  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 1;
    if (record.every((cell) => cell.trim() === '')) return;
    const id = normalizeId(record[idIndex]);
    if (id === '') {
      blankRows.push(rowNumber);
      return;
    }
    if (firstRowById.has(id)) {
      const list = duplicateRows.get(id) ?? [firstRowById.get(id)];
      list.push(rowNumber);
      duplicateRows.set(id, list);
      return;
    }
    firstRowById.set(id, rowNumber);
    rows.push({ id, rowNumber, values: fieldIndexes.map((columnAt) => record[columnAt]) });
  });

  const problems = [];
  if (blankRows.length > 0) {
    problems.push(`blank ID in data ${blankRows.length === 1 ? 'row' : 'rows'} ${listOf(blankRows)}`);
  }
  if (duplicateRows.size > 0) {
    const entries = [...duplicateRows].map(([id, list]) => `${q(id)} (data rows ${list.join(', ')})`);
    problems.push(`duplicate ${entries.length === 1 ? 'ID' : 'IDs'} ${listOf(entries)}`);
  }
  if (problems.length > 0) {
    throw new InputError(
      `CSV column ${q(mapping.idColumn)} must hold a unique, nonempty ID on every row: ${problems.join('; ')}.`,
    );
  }
  if (rows.length === 0) {
    throw new InputError('CSV has a header row but no data rows.');
  }

  return { header, rows, byId: new Map(rows.map((row) => [row.id, row])) };
}

function columnIndex(header, name, where) {
  const matches = [];
  header.forEach((cell, index) => {
    if (cell === name) matches.push(index);
  });
  if (matches.length === 0) {
    const shown = header.slice(0, MAX_HEADER_LISTED).map((cell) => q(cell)).join(', ');
    const more = header.length > MAX_HEADER_LISTED ? `, and ${header.length - MAX_HEADER_LISTED} more` : '';
    throw new InputError(`CSV has no column ${q(name)} (map ${where}). Header columns: ${shown}${more}.`);
  }
  if (matches.length > 1) {
    throw new InputError(
      `CSV column ${q(name)} appears ${matches.length} times in the header; a mapped column must be unique.`,
    );
  }
  return matches[0];
}

function listOf(items) {
  const shown = items.slice(0, MAX_LISTED).join(', ');
  return items.length > MAX_LISTED ? `${shown} and ${items.length - MAX_LISTED} more` : shown;
}
