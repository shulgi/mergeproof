import { normalizeValue } from './normalize.js';

/**
 * Join parsed pages to CSV rows by exact (NFC, edge-trimmed, case-sensitive) ID
 * and compare the mapped fields. Page order and CSV order are independent.
 *
 * Findings: page issues, field mismatches, duplicate PDF IDs, unknown PDF IDs
 * and missing CSV IDs. A CSV row counts as verified only when its ID appears on
 * exactly one valid record page and every mapped field matches. Pages with text
 * but no record labels are listed separately and are not findings. `hints`
 * explain proofs where no record could be read; they are not findings either.
 */
export function reconcile({ csv, pages, mapping }) {
  const pageIssues = [];
  const fieldMismatches = [];
  const unknownIds = [];
  const pagesWithoutRecord = [];
  const pagesById = new Map();
  const issuePagesById = new Map();
  const mismatchedPages = new Set();

  pages.forEach((result, index) => {
    const page = index + 1;
    if (result.status === 'no-record') {
      pagesWithoutRecord.push(page);
      return;
    }
    if (result.status === 'issue') {
      pageIssues.push({ page, kind: result.kind, message: result.message, ids: [...result.ids] });
      for (const id of new Set(result.ids)) append(issuePagesById, id, page);
      return;
    }

    append(pagesById, result.id, page);
    const row = csv.byId.get(result.id);
    if (!row) {
      unknownIds.push({ page, id: result.id });
      return;
    }
    mapping.fields.forEach((field, fieldIndex) => {
      const expected = normalizeValue(row.values[fieldIndex]);
      const extracted = result.fields[fieldIndex] ?? null;
      if (extracted === expected) return;
      mismatchedPages.add(page);
      fieldMismatches.push({
        page,
        id: result.id,
        column: field.column,
        label: field.label,
        expected,
        extracted,
        problem: extracted === null ? 'label-missing' : 'value-differs',
      });
    });
  });

  const duplicateIds = [...pagesById]
    .filter(([, list]) => list.length > 1)
    .map(([id, list]) => ({ id, pages: list, inCsv: csv.byId.has(id) }))
    .sort((a, b) => a.pages[0] - b.pages[0]);

  const missingIds = csv.rows
    .filter((row) => !pagesById.has(row.id))
    .map((row) => ({ id: row.id, csvRow: row.rowNumber, seenOnInvalidPages: issuePagesById.get(row.id) ?? [] }));

  const verifiedRecords = csv.rows.filter((row) => {
    const list = pagesById.get(row.id);
    return list?.length === 1 && !mismatchedPages.has(list[0]);
  }).length;

  const findings =
    pageIssues.length + fieldMismatches.length + duplicateIds.length + unknownIds.length + missingIds.length;

  return {
    status: findings === 0 ? 'pass' : 'fail',
    summary: {
      pages: pages.length,
      csvRows: csv.rows.length,
      fieldsPerRecord: mapping.fields.length,
      recordPages: pages.filter((result) => result.status === 'record').length,
      verifiedRecords,
      findings,
      pageIssues: pageIssues.length,
      fieldMismatches: fieldMismatches.length,
      duplicateIds: duplicateIds.length,
      unknownIds: unknownIds.length,
      missingIds: missingIds.length,
      pagesWithoutRecord: pagesWithoutRecord.length,
    },
    pageIssues,
    fieldMismatches,
    duplicateIds,
    unknownIds,
    missingIds,
    pagesWithoutRecord,
    hints: proofHints(pages, mapping),
  };
}

/**
 * Plain-language hints for proofs where no record could be read at all. They
 * are not findings and never change the status; they point a new user at the
 * likely cause (no live text, or map labels that do not match the PDF text).
 */
export function proofHints(pages, mapping) {
  if (pages.length === 0) return [];
  const readable = pages.filter((result) => !(result.status === 'issue' && result.kind === 'unreadable'));
  if (readable.length === 0) {
    return [
      'No page has extractable text. MergeProof needs a PDF exported with live, selectable text; ' +
        'outlined text and scanned images cannot be checked.',
    ];
  }
  if (readable.every((result) => result.status === 'no-record')) {
    return [
      "None of the map's labels start a line on any page, so no record could be read. Labels must match " +
        `the extracted text exactly, including case and punctuation (idLabel is ${JSON.stringify(mapping.idLabel)}). ` +
        'To see what MergeProof reads, run: mergeproof --show-text --pdf <file> --map <file>',
    ];
  }
  return [];
}

function append(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
