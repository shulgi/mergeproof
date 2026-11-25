/**
 * Text normalization shared by CSV cells, map labels and extracted PDF text.
 *
 * IDs: Unicode NFC plus edge-whitespace trimming only. Case, leading zeros and
 * interior whitespace are kept, so "00042" never equals "42" and "A 7" never
 * equals "a 7" or "A  7".
 *
 * Field values: NFC, then every run of whitespace (spaces, tabs, line breaks,
 * no-break spaces and other Unicode space separators) becomes one space and the
 * edges are trimmed. Punctuation, case and digits are kept. There is no
 * compatibility (NFKC) folding and no approximate matching.
 */

const WHITESPACE_RUN = /\s+/gu;

/** U+FEFF, the byte order mark, built explicitly so the source stays plain ASCII. */
export const BOM = String.fromCharCode(0xfeff);

export function stripBom(text) {
  const value = String(text);
  return value.startsWith(BOM) ? value.slice(1) : value;
}

/** NFC and trim edge whitespace (String.prototype.trim covers Unicode spaces). */
export function trimNfc(value) {
  return String(value ?? '').normalize('NFC').trim();
}

export function normalizeId(value) {
  return trimNfc(value);
}

export function normalizeValue(value) {
  return String(value ?? '').normalize('NFC').replace(WHITESPACE_RUN, ' ').trim();
}
