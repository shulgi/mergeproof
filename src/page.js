import { normalizeId, normalizeValue } from './normalize.js';

/**
 * Page parsing is pure: extracted page text in, one result out.
 *
 *   { status: 'record', id, fields }      one bounded, unambiguous record;
 *                                          fields[i] is the normalized value for
 *                                          mapping.fields[i], or null if absent
 *   { status: 'no-record' }               text, but none of the map's labels
 *   { status: 'issue', kind, message, ids }
 *        kind 'unreadable'                 no extractable text
 *        kind 'invalid-boundary'           start label, end marker or a field
 *                                          label is missing or misplaced
 *        kind 'ambiguous'                  repeated ID label, end marker or field
 *                                          label, or an empty/multi-line ID
 *        ids                               best-effort IDs seen on the page
 *
 * Supported template: a line starting with idLabel opens the record, field
 * lines start with their labels, and a line consisting of exactly endMarker
 * (after NFC normalization and trimming) closes it.
 * A value is the rest of its label line plus following lines up to the next
 * declared label or the end marker. Text before the record and after the end
 * marker is ignored.
 */

export const ISSUE = Object.freeze({
  UNREADABLE: 'unreadable',
  INVALID_BOUNDARY: 'invalid-boundary',
  AMBIGUOUS: 'ambiguous',
});

const WORD_CHAR = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/u;
const LINE_BREAK = /\r\n|\r|\n/;
const q = (value) => JSON.stringify(value);

/**
 * Markers sorted longest first so "Name 2:" wins over "Name". A label that ends
 * in a letter or digit must be followed by whitespace or the end of the line,
 * so the label "Name" does not match "Names". The end marker never matches as a
 * prefix (see matchMarker).
 */
export function buildMarkers(mapping) {
  const markers = [
    { text: mapping.idLabel, kind: 'id', field: -1 },
    { text: mapping.endMarker, kind: 'end', field: -1 },
    ...mapping.fields.map((field, index) => ({ text: field.label, kind: 'field', field: index })),
  ].map((marker) => {
    const chars = Array.from(marker.text);
    return { ...marker, needsBreak: WORD_CHAR.test(chars[chars.length - 1] ?? '') };
  });
  return markers.sort((a, b) => b.text.length - a.text.length);
}

/**
 * `line` must already be NFC-normalized and trimmed. Labels are case-sensitive.
 * The ID label and field labels are line-start prefixes; the end marker must be
 * the whole line, so a footer such as "END RECORD maybe" is not a boundary.
 */
export function matchMarker(line, markers) {
  for (const marker of markers) {
    if (marker.kind === 'end') {
      if (line === marker.text) return marker;
      continue;
    }
    if (!line.startsWith(marker.text)) continue;
    const next = line.charAt(marker.text.length);
    if (marker.needsBreak && next !== '' && !WHITESPACE.test(next)) continue;
    return marker;
  }
  return null;
}

export function parsePage(text, mapping, markers = buildMarkers(mapping)) {
  const entries = String(text ?? '')
    .split(LINE_BREAK)
    .map((raw, index) => {
      const line = raw.normalize('NFC').trim();
      const marker = line === '' ? null : matchMarker(line, markers);
      return { index, line, marker, rest: marker ? line.slice(marker.text.length).trim() : '' };
    });

  if (entries.every((entry) => entry.line === '')) {
    return issue(ISSUE.UNREADABLE, 'no extractable text (blank page, scanned image or outlined text)', []);
  }

  const starts = entries.filter((entry) => entry.marker?.kind === 'id');
  const ends = entries.filter((entry) => entry.marker?.kind === 'end');
  const labelled = entries.filter((entry) => entry.marker?.kind === 'field');
  const ids = unique(starts.map((entry) => candidateId(entries, entry.index)).filter((id) => id !== ''));
  const startLabel = q(mapping.idLabel);
  const endLabel = q(mapping.endMarker);

  if (starts.length === 0) {
    if (ends.length === 0 && labelled.length === 0) return { status: 'no-record' };
    const found = [];
    if (ends.length > 0) found.push(`end marker ${endLabel}`);
    if (labelled.length > 0) {
      const labels = unique(labelled.map((entry) => entry.marker.text));
      found.push(`field ${labels.length === 1 ? 'label' : 'labels'} ${labels.map((label) => q(label)).join(', ')}`);
    }
    return issue(ISSUE.INVALID_BOUNDARY, `found ${found.join(' and ')} but no record start label ${startLabel}`, []);
  }
  if (starts.length > 1) {
    return issue(ISSUE.AMBIGUOUS, `record start label ${startLabel} appears ${starts.length} times`, ids);
  }
  const start = starts[0];

  if (ends.length === 0) {
    return issue(ISSUE.INVALID_BOUNDARY, `end marker ${endLabel} not found after ${startLabel}`, ids);
  }
  if (ends.length > 1) {
    return issue(ISSUE.AMBIGUOUS, `end marker ${endLabel} appears ${ends.length} times`, ids);
  }
  const end = ends[0];
  if (end.index < start.index) {
    return issue(ISSUE.INVALID_BOUNDARY, `end marker ${endLabel} appears before ${startLabel}`, ids);
  }

  const counts = new Map();
  for (const entry of labelled) counts.set(entry.marker.field, (counts.get(entry.marker.field) ?? 0) + 1);
  const repeated = [...counts]
    .filter(([, count]) => count > 1)
    .map(([field, count]) => `field label ${q(mapping.fields[field].label)} appears ${count} times`);
  if (repeated.length > 0) {
    return issue(ISSUE.AMBIGUOUS, repeated.join('; '), ids);
  }

  const outside = labelled.filter((entry) => entry.index < start.index || entry.index > end.index);
  if (outside.length > 0) {
    const labels = unique(outside.map((entry) => entry.marker.text)).map((label) => q(label));
    return issue(
      ISSUE.INVALID_BOUNDARY,
      `field ${labels.length === 1 ? 'label' : 'labels'} ${labels.join(', ')} outside the record block`,
      ids,
    );
  }

  const idPieces = segmentPieces(entries, start.index, end.index);
  if (idPieces.length === 0) {
    return issue(ISSUE.AMBIGUOUS, `record start label ${startLabel} has no ID value`, []);
  }
  if (idPieces.length > 1) {
    return issue(ISSUE.AMBIGUOUS, `the record ID after ${startLabel} spans ${idPieces.length} lines`, ids);
  }

  const fields = mapping.fields.map(() => null);
  for (const entry of labelled) {
    fields[entry.marker.field] = normalizeValue(segmentPieces(entries, entry.index, end.index).join('\n'));
  }
  return { status: 'record', id: normalizeId(idPieces[0]), fields };
}

/** Non-empty text of the segment opened at `start`: inline rest plus following unlabelled lines. */
function segmentPieces(entries, start, limit) {
  const pieces = entries[start].rest === '' ? [] : [entries[start].rest];
  for (let index = start + 1; index < limit; index += 1) {
    if (entries[index].marker) break;
    if (entries[index].line !== '') pieces.push(entries[index].line);
  }
  return pieces;
}

function candidateId(entries, start) {
  const pieces = segmentPieces(entries, start, entries.length);
  return pieces.length > 0 ? normalizeId(pieces[0]) : '';
}

function issue(kind, message, ids) {
  return { status: 'issue', kind, message, ids };
}

function unique(items) {
  return [...new Set(items)];
}
