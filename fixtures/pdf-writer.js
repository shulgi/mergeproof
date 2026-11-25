import { createHash } from 'node:crypto';

/**
 * Minimal, dependency-free PDF 1.4 writer for synthetic fixtures.
 *
 * - One standard-14 font: Courier with /WinAnsiEncoding and explicit widths
 *   (every Courier glyph is 600 units wide, so the widths are exact).
 * - Text is drawn as literal strings: "(", ")" and "\" are backslash-escaped
 *   and every byte outside printable ASCII is written as a 3-digit octal escape,
 *   so the file body is plain ASCII.
 * - Classic cross-reference table with exact byte offsets; deterministic output
 *   (no dates; the trailer /ID is a hash of the body).
 *
 * Each page is an array of lines. An empty array produces a page without text.
 */

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const GLYPH_WIDTH = 600;
const FIRST_CHAR = 32;
const LAST_CHAR = 255;

/** Unicode code points in WinAnsiEncoding's 0x80-0x9F block (PDF 32000-1, Annex D). */
const WIN_ANSI_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

/**
 * Encode text (NFC first) as WinAnsi bytes. Accepts printable ASCII, Latin-1
 * 0xA1-0xFF except the soft hyphen, and the 0x80-0x9F punctuation block.
 * No-break space and control characters are rejected to keep fixtures exact.
 */
export function encodeWinAnsi(text) {
  const bytes = [];
  for (const char of String(text).normalize('NFC')) {
    const code = char.codePointAt(0);
    if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else if (code >= 0xa1 && code <= 0xff && code !== 0xad) bytes.push(code);
    else if (WIN_ANSI_HIGH.has(code)) bytes.push(WIN_ANSI_HIGH.get(code));
    else {
      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      throw new Error(`Cannot encode ${JSON.stringify(char)} (U+${hex}) in WinAnsiEncoding`);
    }
  }
  return bytes;
}

/** PDF literal string with escaped delimiters and octal escapes for non-ASCII bytes. */
export function pdfLiteral(text) {
  let out = '(';
  for (const byte of encodeWinAnsi(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

function widthsArray() {
  const count = LAST_CHAR - FIRST_CHAR + 1;
  const rows = [];
  for (let i = 0; i < count; i += 16) {
    rows.push(Array(Math.min(16, count - i)).fill(GLYPH_WIDTH).join(' '));
  }
  return `[\n${rows.join('\n')}\n]`;
}

function contentStream(lines, { fontSize, leading, left, top, maxChars }) {
  if (lines.length === 0) return '';
  const ops = ['BT', `/F1 ${fontSize} Tf`, `${left} ${top} Td`];
  lines.forEach((line, index) => {
    if (typeof line !== 'string') throw new TypeError('Page lines must be strings');
    if (Array.from(line).length > maxChars) {
      throw new Error(`Line is longer than ${maxChars} characters and would leave the page: ${JSON.stringify(line)}`);
    }
    if (index > 0) ops.push(`0 -${leading} Td`);
    if (line !== '') ops.push(`${pdfLiteral(line)} Tj`);
  });
  ops.push('ET');
  return ops.join('\n');
}

export function buildPdf(
  pages,
  { title = 'MergeProof synthetic sample', fontSize = 10, leading = 14, left = 72, top = 740 } = {},
) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('buildPdf needs at least one page');
  const maxLines = Math.floor((top - 36) / leading) + 1;
  const maxChars = Math.floor((PAGE_WIDTH - left - 36) / ((GLYPH_WIDTH / 1000) * fontSize));

  // Object numbers: 1 catalog, 2 page tree, 3 font, 4 widths, 5 info,
  // then a page object and its content stream for each page.
  const firstPage = 6;
  const kids = pages.map((_, index) => `${firstPage + 2 * index} 0 R`).join(' ');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding ` +
      `/FirstChar ${FIRST_CHAR} /LastChar ${LAST_CHAR} /Widths 4 0 R >>`,
    widthsArray(),
    `<< /Title ${pdfLiteral(title)} /Producer ${pdfLiteral('MergeProof fixture generator')} >>`,
  ];
  pages.forEach((lines, index) => {
    if (!Array.isArray(lines)) throw new TypeError('Each page must be an array of lines');
    if (lines.length > maxLines) throw new Error(`Page ${index + 1} has more than ${maxLines} lines`);
    const content = contentStream(lines, { fontSize, leading, left, top, maxChars });
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + 2 * index + 1} 0 R >>`,
    );
    bodies.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const chunks = [];
  let offset = 0;
  const write = (text) => {
    const bytes = Buffer.from(text, 'latin1');
    chunks.push(bytes);
    offset += bytes.length;
  };

  // Header plus the customary comment of four bytes above 127, marking the file as binary.
  write(`%PDF-1.4\n%${String.fromCharCode(0xe2, 0xe3, 0xcf, 0xd3)}\n`);
  const offsets = bodies.map((body, index) => {
    const at = offset;
    write(`${index + 1} 0 obj\n${body}\nendobj\n`);
    return at;
  });
  const xrefAt = offset;
  const entries = offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('');
  write(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${entries}`);

  const id = createHash('sha256').update(Buffer.concat(chunks)).digest('hex').slice(0, 32);
  write(
    `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R /Info 5 0 R /ID [<${id}> <${id}>] >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`,
  );
  return Buffer.concat(chunks);
}
