import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildCsv, SAMPLE_COLUMNS, SAMPLE_MAP, SAMPLE_ROWS, writeSamples } from '../fixtures/samples.js';
import { ROOT, runCli, sha256 } from './helpers.js';

// End-to-end: the real CLI, real pdftotext, generated samples in a directory with spaces.

let dir;
let files;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mergeproof cli '));
  files = await writeSamples(join(dir, 'sample inputs'));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const args = (overrides = {}) => {
  const paths = { csv: files.csv, map: files.map, pdf: files.cleanPdf, ...overrides };
  return ['--csv', paths.csv, '--map', paths.map, '--pdf', paths.pdf];
};

async function hashes(paths) {
  return Promise.all(paths.map((path) => sha256(path)));
}

describe('sample proofs', () => {
  test('the clean sample passes with exit 0 and leaves inputs unchanged', async () => {
    const inputs = [files.csv, files.map, files.cleanPdf];
    const original = await hashes(inputs);
    const { code, stdout, stderr } = await runCli(args());
    assert.equal(stderr, '');
    assert.equal(code, 0, stdout);
    assert.match(stdout, /^MergeProof PASS: 0 findings\n/);
    assert.match(stdout, /7 pages, 6 CSV rows, 6 records verified \(5 fields each\)/);
    assert.match(stdout, /Pages without a record \(not findings\): 1\n/);
    assert.deepEqual(await hashes(inputs), original);
  });

  test('the clean sample JSON report confirms every record on its own page', async () => {
    const { code, stdout } = await runCli([...args(), '--json']);
    assert.equal(code, 0, stdout);
    const report = JSON.parse(stdout);
    assert.equal(report.status, 'pass');
    assert.equal(report.exitCode, 0);
    assert.deepEqual(report.summary, {
      pages: 7,
      csvRows: 6,
      fieldsPerRecord: 5,
      recordPages: 6,
      verifiedRecords: 6,
      findings: 0,
      pageIssues: 0,
      fieldMismatches: 0,
      duplicateIds: 0,
      unknownIds: 0,
      missingIds: 0,
      pagesWithoutRecord: 1,
    });
    assert.deepEqual(report.pagesWithoutRecord, [1]);
    assert.deepEqual(report.hints, []);
  });

  test('the broken sample exits 1 and the text report locates every finding', async () => {
    const inputs = [files.csv, files.map, files.brokenPdf];
    const original = await hashes(inputs);
    const { code, stdout, stderr } = await runCli(args({ pdf: files.brokenPdf }));
    assert.equal(stderr, '');
    assert.equal(code, 1, stdout);
    const lines = stdout.split('\n');
    const expected = [
      'MergeProof FAIL: 10 findings',
      '  9 pages, 6 CSV rows, 0 records verified (5 fields each)',
      '  page 7: unreadable - no extractable text (blank page, scanned image or outlined text)',
      '  page 8: invalid boundary - end marker "END OF RECORD" not found after "Member ID:" (ID "KX 9")',
      '  page 9: ambiguous - record start label "Member ID:" appears 2 times (IDs "Ö-17", "a-0310")',
      '  page 2, ID "00042", Balance: expected "€1,250.00", found "€1,205.00"',
      '  page 3, ID "00107", Postcode: expected "114 51", but label "Postcode:" is not in the record block',
      '  ID "A-0310" on pages 4, 5',
      '  page 6: ID "Z-999" is not in the CSV',
      '  ID "a-0310" (CSV data row 4) was not verified on any page; seen on unverified page 9',
      '  ID "KX 9" (CSV data row 5) was not verified on any page; seen on unverified page 8',
      '  ID "Ö-17" (CSV data row 6) was not verified on any page; seen on unverified page 9',
      'Pages without a record (not findings): 1',
    ].map((line) => line.normalize('NFC'));
    for (const line of expected) assert.ok(lines.includes(line), `missing line: ${line}\n---\n${stdout}`);
    assert.deepEqual(await hashes(inputs), original);
  });

  test('the broken sample JSON report has exact findings with real extracted UTF-8 values', async () => {
    const { code, stdout } = await runCli([...args({ pdf: files.brokenPdf }), '--json']);
    assert.equal(code, 1, stdout);
    const report = JSON.parse(stdout);
    const nfc = (value) => value.normalize('NFC');
    assert.equal(report.status, 'fail');
    assert.equal(report.exitCode, 1);
    assert.equal(report.summary.findings, 10);
    assert.deepEqual(
      report.pageIssues.map(({ page, kind, ids }) => ({ page, kind, ids })),
      [
        { page: 7, kind: 'unreadable', ids: [] },
        { page: 8, kind: 'invalid-boundary', ids: ['KX 9'] },
        { page: 9, kind: 'ambiguous', ids: [nfc('Ö-17'), 'a-0310'] },
      ],
    );
    assert.deepEqual(report.fieldMismatches, [
      {
        page: 2,
        id: '00042',
        column: 'Balance',
        label: 'Balance:',
        expected: nfc('€1,250.00'),
        extracted: nfc('€1,205.00'),
        problem: 'value-differs',
      },
      {
        page: 3,
        id: '00107',
        column: 'Postcode',
        label: 'Postcode:',
        expected: '114 51',
        extracted: null,
        problem: 'label-missing',
      },
    ]);
    assert.deepEqual(report.duplicateIds, [{ id: 'A-0310', pages: [4, 5], inCsv: true }]);
    assert.deepEqual(report.unknownIds, [{ page: 6, id: 'Z-999' }]);
    assert.deepEqual(report.missingIds, [
      { id: 'a-0310', csvRow: 4, seenOnInvalidPages: [9] },
      { id: 'KX 9', csvRow: 5, seenOnInvalidPages: [8] },
      { id: nfc('Ö-17'), csvRow: 6, seenOnInvalidPages: [9] },
    ]);
    assert.deepEqual(report.pagesWithoutRecord, [1]);
  });

  test('paths with spaces and shell characters are passed to pdftotext literally', async () => {
    const oddDir = join(dir, "odd $(touch x) dir");
    await mkdir(oddDir, { recursive: true });
    const oddPdf = join(oddDir, "clean; 'quoted' & -layout.pdf");
    await copyFile(files.cleanPdf, oddPdf);
    const { code, stdout } = await runCli(args({ pdf: oddPdf }));
    assert.equal(code, 0, stdout);
    assert.match(stdout, /^MergeProof PASS/);
  });

  test('a map whose labels are not in the PDF fails with a hint pointing at --show-text', async () => {
    const wrongMap = join(dir, 'wrong labels map.json');
    await writeFile(
      wrongMap,
      JSON.stringify({
        idColumn: 'Member ID',
        idLabel: 'Member No:',
        endMarker: 'END',
        fields: [{ label: 'Full name:', column: 'Full Name' }],
      }),
    );
    const { code, stdout, stderr } = await runCli(args({ map: wrongMap }));
    assert.equal(stderr, '');
    assert.equal(code, 1, stdout);
    assert.match(stdout, /^MergeProof FAIL: 6 findings\n/);
    assert.match(stdout, /Pages without a record \(not findings\): 1-7\n/);
    assert.match(stdout, /\nHint: None of the map's labels start a line on any page.*idLabel is "Member No:".*--show-text/);
  });
});

describe('--show-text', () => {
  test('lists the extracted text of every page without a map', async () => {
    const { code, stdout, stderr } = await runCli(['--show-text', '--pdf', files.brokenPdf]);
    assert.equal(stderr, '');
    assert.equal(code, 0, stdout);
    const lines = stdout.split('\n');
    assert.equal(lines[0], `MergeProof extracted text: ${files.brokenPdf} (9 pages)`);
    for (const line of ['--- page 1 ---', '  Annual statements, synthetic merge sample', '--- page 7 ---', '  (no extractable text)']) {
      assert.ok(lines.includes(line), `missing line: ${line}\n---\n${stdout}`);
    }
  });

  test('with a map, tags label lines and gives each page result, leaving inputs unchanged', async () => {
    const inputs = [files.map, files.brokenPdf];
    const original = await hashes(inputs);
    const { code, stdout, stderr } = await runCli(['--show-text', '--pdf', files.brokenPdf, '--map', files.map]);
    assert.equal(stderr, '');
    assert.equal(code, 0, stdout);
    const lines = stdout.split('\n');
    const expected = [
      '--- page 1: no record ---',
      '--- page 2: record "00042" ---',
      '        Annual statement 2026',
      '  [id]  Member ID: 00042',
      '  [fld] Balance: €1,205.00',
      '  [end] END OF RECORD',
      '--- page 7: unreadable - no extractable text (blank page, scanned image or outlined text) ---',
      '--- page 8: invalid boundary - end marker "END OF RECORD" not found after "Member ID:" ---',
      '--- page 9: ambiguous - record start label "Member ID:" appears 2 times ---',
    ].map((line) => line.normalize('NFC'));
    for (const line of expected) assert.ok(lines.includes(line), `missing line: ${line}\n---\n${stdout}`);
    assert.deepEqual(await hashes(inputs), original);
  });

  test('a missing PDF is an input error', async () => {
    const { code, stdout, stderr } = await runCli(['--show-text', '--pdf', join(dir, 'nope.pdf')]);
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /^mergeproof: error: PDF file not found: .*nope\.pdf/);
  });
});

describe('usage errors exit 2', () => {
  const cases = [
    ['no arguments', [], /Missing required options: --csv <file>, --pdf <file>, --map <file>/],
    ['a missing option', ['--csv', 'a.csv', '--map', 'm.json'], /Missing required option: --pdf <file>/],
    ['an unknown option', ['--csv', 'a.csv', '--fuzzy'], /Unknown option '--fuzzy'/],
    ['a positional argument', ['extra.pdf'], /positional/i],
    ['a repeated option', ['--csv', 'a.csv', '--csv', 'b.csv'], /--csv was given more than once/],
    ['an option without its value', ['--map', 'm.json', '--pdf', 'p.pdf', '--csv'], /--csv/],
    ['an empty path', ['--csv', '', '--map', 'm.json', '--pdf', 'p.pdf'], /--csv needs a file path/],
    ['--show-text without --pdf', ['--show-text'], /--show-text needs --pdf <file>/],
    ['--show-text with --csv', ['--show-text', '--csv', 'a.csv', '--pdf', 'p.pdf'], /--show-text cannot be combined with --csv/],
  ];
  for (const [name, argv, pattern] of cases) {
    test(name, async () => {
      const { code, stdout, stderr } = await runCli(argv);
      assert.equal(code, 2);
      assert.equal(stdout, '');
      assert.match(stderr, /^mergeproof: error: /);
      assert.match(stderr, pattern);
      assert.match(stderr, /Run "mergeproof --help" for usage\./);
    });
  }

  test('--help and --version exit 0', async () => {
    const help = await runCli(['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage: mergeproof --csv <file> --pdf <file> --map <file> \[--json\]/);
    const version = await runCli(['--version']);
    assert.equal(version.code, 0);
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(version.stdout, `${pkg.version}\n`);
  });

  test('--json reports usage errors as JSON with status "error"', async () => {
    const { code, stdout } = await runCli(['--json', '--bogus']);
    assert.equal(code, 2);
    const report = JSON.parse(stdout);
    assert.equal(report.status, 'error');
    assert.equal(report.exitCode, 2);
    assert.equal(report.error.kind, 'usage');
  });
});

describe('unusable inputs exit 2 with a useful message', () => {
  async function write(name, content) {
    const path = join(dir, 'bad inputs', name);
    await mkdir(join(dir, 'bad inputs'), { recursive: true });
    await writeFile(path, content);
    return path;
  }

  async function expectInputError(argv, pattern, env) {
    const { code, stdout, stderr } = await runCli(argv, env ? { env } : undefined);
    assert.equal(code, 2, stderr);
    assert.equal(stdout, '');
    assert.match(stderr, /^mergeproof: error: /);
    assert.match(stderr, pattern);
    assert.doesNotMatch(stderr, /Run "mergeproof --help"/);
  }

  test('missing input files are all reported', async () => {
    await expectInputError(
      args({ csv: join(dir, 'nope.csv'), pdf: join(dir, 'nope.pdf') }),
      /CSV file not found: .*nope\.csv\nPDF file not found: .*nope\.pdf/,
    );
  });

  test('duplicate source IDs', async () => {
    const csv = await write('duplicate ids.csv', buildCsv(SAMPLE_COLUMNS, [...SAMPLE_ROWS, { ...SAMPLE_ROWS[0], 'Full Name': 'Someone Else' }]));
    await expectInputError(args({ csv }), /duplicate ID "00042" \(data rows 1, 7\)/);
  });

  test('blank source IDs', async () => {
    const csv = await write('blank ids.csv', buildCsv(SAMPLE_COLUMNS, [...SAMPLE_ROWS, { ...SAMPLE_ROWS[1], 'Member ID': '   ' }]));
    await expectInputError(args({ csv }), /blank ID in data row 7/);
  });

  test('malformed CSV', async () => {
    const csv = await write('malformed.csv', 'Member ID,Full Name\n"00042,Unclosed quote\n');
    await expectInputError(args({ csv }), /Malformed CSV/);
  });

  test('CSV without a mapped column', async () => {
    const csv = await write('no postcode.csv', buildCsv(SAMPLE_COLUMNS.filter((c) => c !== 'Postcode'), SAMPLE_ROWS));
    await expectInputError(args({ csv }), /CSV has no column "Postcode"/);
  });

  test('map that is not JSON', async () => {
    const map = await write('broken map.json', '{ "idColumn": "Member ID", ');
    await expectInputError(args({ map }), /Map is not valid JSON/);
  });

  test('map with an unsupported key', async () => {
    const map = await write('typo map.json', JSON.stringify({ ...SAMPLE_MAP, endmarker: 'END' }));
    await expectInputError(args({ map }), /unsupported key "endmarker"/);
  });

  test('damaged PDF', async () => {
    const pdf = await write('damaged.pdf', '%PDF-1.4\n% damaged on purpose: no objects, no cross-reference table\n');
    await expectInputError(args({ pdf }), /pdftotext/);
  });

  test('missing Poppler', async () => {
    const emptyBin = await mkdtemp(join(dir, 'empty bin '));
    await expectInputError(args(), /pdftotext was not found/, { ...process.env, PATH: emptyBin });
  });

  test('--json reports input errors as JSON with status "error" on stdout', async () => {
    const { code, stdout, stderr } = await runCli([...args({ csv: join(dir, 'nope.csv') }), '--json']);
    assert.equal(code, 2);
    assert.equal(stderr, '');
    const report = JSON.parse(stdout);
    assert.equal(report.status, 'error');
    assert.equal(report.error.kind, 'input');
    assert.match(report.error.message, /CSV file not found/);
  });
});
