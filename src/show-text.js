import { buildMarkers, matchMarker, parsePage } from './page.js';
import { ISSUE_LABEL } from './report.js';

const LINE_BREAK = /\r\n|\r|\n/;
const TAGS = Object.freeze({ id: '[id]  ', field: '[fld] ', end: '[end] ' });
const NO_TAG = '      ';
const q = (value) => JSON.stringify(value);

/**
 * Format the text pdftotext extracted from each physical page (`texts[i]` is
 * page i + 1) so a map can be written against what MergeProof actually reads.
 * Lines are NFC-normalized and trimmed, exactly as the page parser sees them,
 * and blank lines are left out.
 *
 * With a mapping, each page header carries the parser's result for that page
 * and each line that starts with a map label is tagged [id], [fld] or [end].
 */
export function formatExtractedText(texts, { pdf, mapping = null } = {}) {
  const markers = mapping ? buildMarkers(mapping) : null;
  const out = [
    `MergeProof extracted text: ${pdf} (${texts.length} ${texts.length === 1 ? 'page' : 'pages'})`,
    mapping
      ? 'Lines are trimmed and NFC-normalized; blank lines are omitted. [id], [fld] and [end] mark map labels.'
      : 'Lines are trimmed and NFC-normalized; blank lines are omitted. Add --map <file> to mark map labels.',
  ];

  texts.forEach((text, index) => {
    const lines = String(text ?? '')
      .split(LINE_BREAK)
      .map((raw) => raw.normalize('NFC').trim())
      .filter((line) => line !== '');
    const status = markers ? `: ${pageStatus(parsePage(text, mapping, markers))}` : '';
    out.push('', `--- page ${index + 1}${status} ---`);
    if (lines.length === 0) {
      // With a map, the header already says the page is unreadable.
      if (!markers) out.push('  (no extractable text)');
      return;
    }
    for (const line of lines) {
      if (!markers) {
        out.push(`  ${line}`);
        continue;
      }
      const marker = matchMarker(line, markers);
      out.push(`  ${marker ? TAGS[marker.kind] : NO_TAG}${line}`);
    }
  });
  return `${out.join('\n')}\n`;
}

function pageStatus(result) {
  if (result.status === 'record') return `record ${q(result.id)}`;
  if (result.status === 'no-record') return 'no record';
  return `${ISSUE_LABEL[result.kind] ?? result.kind} - ${result.message}`;
}
