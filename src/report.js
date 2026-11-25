export const SCHEMA_VERSION = 1;

const q = (value) => JSON.stringify(value);
/** Human-readable names for page issue kinds (see ISSUE in page.js). */
export const ISSUE_LABEL = Object.freeze({
  unreadable: 'unreadable',
  'invalid-boundary': 'invalid boundary',
  ambiguous: 'ambiguous',
});

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

/** "1, 2" stays as is; runs of three or more ascending pages become "4-9". */
export function formatPageList(pages) {
  const parts = [];
  let index = 0;
  while (index < pages.length) {
    let last = index;
    while (last + 1 < pages.length && pages[last + 1] === pages[last] + 1) last += 1;
    if (last - index >= 2) parts.push(`${pages[index]}-${pages[last]}`);
    else for (let k = index; k <= last; k += 1) parts.push(String(pages[k]));
    index = last + 1;
  }
  return parts.join(', ');
}

function pagesPhrase(pages) {
  return `${pages.length === 1 ? 'page' : 'pages'} ${formatPageList(pages)}`;
}

function section(out, title, items, describe) {
  if (items.length === 0) return;
  out.push('', `${title} (${items.length})`);
  for (const item of items) out.push(`  ${describe(item)}`);
}

export function formatText(result) {
  const s = result.summary;
  const out = [
    `MergeProof ${result.status === 'pass' ? 'PASS' : 'FAIL'}: ${plural(s.findings, 'finding')}`,
    `  ${plural(s.pages, 'page')}, ${plural(s.csvRows, 'CSV row')}, ${plural(s.verifiedRecords, 'record')} ` +
      `verified (${plural(s.fieldsPerRecord, 'field')} each)`,
  ];

  section(out, 'Page issues', result.pageIssues, (item) => {
    const ids = item.ids.length > 0 ? ` (${item.ids.length === 1 ? 'ID' : 'IDs'} ${item.ids.map(q).join(', ')})` : '';
    return `page ${item.page}: ${ISSUE_LABEL[item.kind] ?? item.kind} - ${item.message}${ids}`;
  });
  section(out, 'Field mismatches', result.fieldMismatches, (item) =>
    item.problem === 'label-missing'
      ? `page ${item.page}, ID ${q(item.id)}, ${item.column}: expected ${q(item.expected)}, ` +
        `but label ${q(item.label)} is not in the record block`
      : `page ${item.page}, ID ${q(item.id)}, ${item.column}: expected ${q(item.expected)}, found ${q(item.extracted)}`,
  );
  section(
    out,
    'Duplicate PDF IDs',
    result.duplicateIds,
    (item) => `ID ${q(item.id)} on ${pagesPhrase(item.pages)}${item.inCsv ? '' : ' (and not in the CSV)'}`,
  );
  section(out, 'Unknown PDF IDs', result.unknownIds, (item) => `page ${item.page}: ID ${q(item.id)} is not in the CSV`);
  section(out, 'Missing CSV IDs', result.missingIds, (item) => {
    const seen =
      item.seenOnInvalidPages.length > 0 ? `; seen on unverified ${pagesPhrase(item.seenOnInvalidPages)}` : '';
    return `ID ${q(item.id)} (CSV data row ${item.csvRow}) was not verified on any page${seen}`;
  });

  if (result.pagesWithoutRecord.length > 0) {
    out.push('', `Pages without a record (not findings): ${formatPageList(result.pagesWithoutRecord)}`);
  }
  for (const hint of result.hints ?? []) out.push('', `Hint: ${hint}`);
  return `${out.join('\n')}\n`;
}

export function formatJson(result) {
  const report = {
    tool: 'mergeproof',
    schemaVersion: SCHEMA_VERSION,
    status: result.status,
    exitCode: result.status === 'pass' ? 0 : 1,
    inputs: result.inputs ?? null,
    summary: result.summary,
    pageIssues: result.pageIssues,
    fieldMismatches: result.fieldMismatches,
    duplicateIds: result.duplicateIds,
    unknownIds: result.unknownIds,
    missingIds: result.missingIds,
    pagesWithoutRecord: result.pagesWithoutRecord,
    hints: result.hints ?? [],
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** `kind` is 'usage', 'input' or 'internal'. Always exit code 2, never a proof result. */
export function formatJsonError(kind, message) {
  const report = {
    tool: 'mergeproof',
    schemaVersion: SCHEMA_VERSION,
    status: 'error',
    exitCode: 2,
    error: { kind, message },
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
