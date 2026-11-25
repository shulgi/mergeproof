# MergeProof

[Project website and interactive sample](https://shulgi.github.io/mergeproof/)

MergeProof checks a merged PDF that has native text against the CSV that supplied the merge. On each page it finds the record ID, joins it to the matching CSV row, and compares the printed fields you choose. It reports physical page numbers for every wrong or absent field, every duplicate, unknown or missing ID, and every page it could not verify.

Everything runs on your machine. There is no account, upload, model, web service or telemetry, and input files are only read.

> **Public beta (0.2.0-beta.1).** MergeProof checks **text only**. It does not check fonts, font substitution, colour, images, layout, overset or clipped text, barcodes, or scanned (OCR) pages. A clean result means the printed text matches the CSV. It does not mean the job is ready to print, so keep your visual proof. If a visual check would decide whether you use MergeProof, please say which one in your feedback.

## Prerequisites

- macOS or Linux (Windows is not supported in the beta)
- Node.js 22 or newer (`node --version`)
- Poppler's `pdftotext` on your `PATH` (`pdftotext -v`)
  - macOS (Homebrew): `brew install poppler`
  - Debian/Ubuntu: `sudo apt-get install poppler-utils`
  - Fedora: `sudo dnf install poppler-utils`

## Install

MergeProof is not published to npm. Install it from source, using either the `source.zip` download or a Git checkout.

- **From `source.zip`:** unpack it. It contains one folder called `source`, which holds this README. Go into that folder:

  ```sh
  cd source            # the folder unpacked from source.zip
  npm ci               # installs the one locked dependency, csv-parse
  ```

- **From a Git checkout:** go into the checkout folder (the one that holds this README) and run `npm ci` there.

The commands below run `node bin/mergeproof.js` from that folder, whatever it is called. Optionally, `npm install --global .` adds a `mergeproof` command to your `PATH`.

## Quickstart with the synthetic samples

```sh
npm run sample
node bin/mergeproof.js --csv samples/records.csv --map samples/map.json --pdf samples/proof-clean.pdf
node bin/mergeproof.js --csv samples/records.csv --map samples/map.json --pdf samples/proof-broken.pdf
node bin/mergeproof.js --csv samples/records.csv --map samples/map.json --pdf samples/proof-broken.pdf --json
```

`npm run sample` runs `fixtures/generate.js`. It writes four original, deterministic files to `samples/`, which is git-ignored:

| File | Contents |
| --- | --- |
| `map.json` | the mapping for the sample template |
| `records.csv` | 6 invented member records: UTF-8 with BOM, CRLF rows, quoted commas, doubled quotes, multiline addresses, leading-zero IDs (`00042`), case-distinct IDs (`A-0310` and `a-0310`), an ID with a space (`KX 9`), a non-ASCII ID (`Ö-17`) and one name stored decomposed (NFD) |
| `proof-clean.pdf` | a cover page plus all 6 records in a different order from the CSV |
| `proof-broken.pdf` | 9 pages with deliberate faults |

**Clean proof:** expect `MergeProof PASS: 0 findings`, then `7 pages, 6 CSV rows, 6 records verified`, with page 1 listed as a page without a record. Exit status 0.

**Broken proof:** expect `MergeProof FAIL: 10 findings` and exit status 1. The faults are:

- page 2: `00042` has the wrong Balance (`€1,205.00` instead of `€1,250.00`)
- page 3: `00107` has no `Postcode:` line
- pages 4 and 5: `A-0310` appears twice (duplicate PDF ID)
- page 6: `Z-999` is not in the CSV (unknown PDF ID)
- page 7: blank, with no extractable text (unreadable)
- page 8: `KX 9` has no end marker (invalid boundary)
- page 9: two `Member ID:` lines (ambiguous)
- so `a-0310`, `KX 9` and `Ö-17` are never verified (missing CSV IDs), and the report names the unverified page where each one was seen

`npm run proof:clean` and `npm run proof:broken` run the same commands. npm adds its own error lines when the exit status is 1.

## Running it on your own job

1. **Prepare the template.** Each record goes on its own page. Print a visible ID line, for example `Member ID: 00042`, and a closing line that holds only an end marker, for example `END OF RECORD`. Each field you want checked starts its own line with a label, for example `Name: …`.
2. **Export the merged PDF with live text.** Outlined text and flattened or scanned pages cannot be read.
3. **Look at what MergeProof reads:**

   ```sh
   node bin/mergeproof.js --show-text --pdf "path/to/final merged.pdf"
   ```

   This prints each page's text as `pdftotext` extracts it, trimmed and NFC-normalized, without blank lines. Copy your labels from here. The extracted reading order can differ from what you see on the page.
4. **Write the map** (below), then check it against the PDF:

   ```sh
   node bin/mergeproof.js --show-text --pdf "path/to/final merged.pdf" --map path/to/map.json
   ```

   Lines that start with a map label are tagged `[id]`, `[fld]` or `[end]`, and each page header shows the result, such as `record "00042"`, `no record` or the page issue.
5. **Run the proof:**

   ```sh
   node bin/mergeproof.js --csv path/to/data.csv --pdf "path/to/final merged.pdf" --map path/to/map.json [--json]
   ```

If no page has text, or none of your labels appear anywhere, the report ends with a `Hint:` line saying so.

### The map

Write a small JSON file. MergeProof accepts only these keys and rejects anything else, so typos are caught:

```json
{
  "idColumn": "Member ID",
  "idLabel": "Member ID:",
  "endMarker": "END OF RECORD",
  "fields": [
    { "label": "Name:", "column": "Full Name" },
    { "label": "Address:", "column": "Mailing Address" }
  ]
}
```

- `idColumn`: the CSV header of the unique ID column.
- `idLabel`: the printed text at the start of the line that opens a record, for example `Member ID: 00042`.
- `endMarker`: the printed text of the line that closes the record. It must be the whole line on its own, so with `"endMarker": "END OF RECORD"` a line `END OF RECORD (continued)` is not a boundary.
- `fields`: each printed label with the CSV column it should match. Two labels may use the same column.

Labels are matched literally and case-sensitively, after Unicode NFC normalization and trimming of each line. `idLabel` and field labels match at the start of a line. Include the colon if one is printed. If one of these labels ends in a letter or digit, it must be followed by a space or the end of the line, so `Name` does not match `Names`. When labels overlap, the longest one wins. `endMarker` matches only a line that is exactly the marker, never a prefix: a footer such as `END OF RECORD maybe` does not close a record, so a page whose only closing line looks like that is reported as an invalid boundary. `idLabel`, `endMarker` and the field labels must all be different.

### Supported template

- Each page holds at most one record. The ID label line opens it, field label lines follow in any order, and a line consisting of exactly the end marker closes it. Text above the ID line and below the end marker is ignored.
- A value is whatever follows its label on the same line, plus any lines after it up to the next declared label or the end marker. Values can therefore sit inline or on the following lines and can span several lines. Every line inside the block belongs to the ID or to a field.
- The ID must be a single line: the rest of the ID line, or the one line after it.
- A page cannot pass if it has no extractable text, is missing its start label or end marker, has the end marker before the start, has more than one ID label or end marker, repeats a field label, has a field label outside the block, or has an empty or multi-line ID. These are reported as page issues.
- In a bounded, unambiguous block, a missing field label is a field mismatch.
- A page with text but none of the labels (a cover page, for example) is listed as a page without a record. It is not a finding.

### CSV

- Comma-separated UTF-8, with or without a BOM, and a header row. Quoted cells may contain commas, doubled quotes and line breaks.
- The ID column must be unique and nonempty on every row. Rows where every cell is blank are skipped. Duplicate or blank IDs stop the run with exit status 2.
- Cells stay strings, so leading zeros are kept. Extra columns are allowed.

### Matching rules

- **IDs** are compared exactly after NFC normalization and trimming of edge whitespace. Case, leading zeros and interior whitespace all count, so `00042` and `42` are different IDs, and so are `A-0310` and `a-0310`.
- **Field values** are compared after NFC normalization, with every run of whitespace (including line breaks and no-break spaces) collapsed to one space. Punctuation, case and digits all count.
- There is no approximate or fuzzy matching.

## Output and exit status

The default text report is short. It gives a PASS/FAIL line and a summary, then sections for page issues, field mismatches (page, ID, column, expected and found values), duplicate PDF IDs, unknown PDF IDs and missing CSV IDs. Pages without a record come next, then any hints.

`--json` prints one JSON object with `status` (`pass` or `fail`), `exitCode`, `inputs`, `summary` and the lists `pageIssues`, `fieldMismatches`, `duplicateIds`, `unknownIds`, `missingIds`, `pagesWithoutRecord` and `hints`. Every finding carries physical page numbers. `hints` holds plain-language strings. They are not findings and never change the status. For an unusable invocation or input, `--json` prints `{"status": "error", "exitCode": 2, "error": {"kind", "message"}}` to stdout instead.

| Exit | Meaning |
| --- | --- |
| 0 | clean proof: every CSV row verified on exactly one page, no findings |
| 1 | the proof ran and found something to fix |
| 2 | unusable invocation or input: bad arguments, missing file, duplicate or blank CSV IDs, malformed CSV, bad map, damaged PDF, missing `pdftotext`, or an output or time limit reached |

A "records verified" count only includes CSV rows that appear on exactly one valid page with every mapped field matching. `--show-text` exits 0 when the PDF could be read and 2 otherwise.

### Agent handoff recipe

MergeProof works without any particular merge tool. One workflow: Adobe's [InDesign AI Assistant](https://helpx.adobe.com/indesign/desktop/generative-ai-features/use-ai-assistant.html) can run Data Merge in InDesign (see Adobe's page for what it currently supports). When you have exported the final PDF to a local folder, a coding agent or script can proof it using that PDF, the same CSV and a saved map. MergeProof does not connect to InDesign, Adobe or any account, and it makes no network requests. The handoff is just local files and the existing `--json` output:

```sh
node bin/mergeproof.js --csv data.csv --map map.json --pdf "final merged.pdf" --json > proof.json
status=$?
```

Branch on the exit status. The same value is in `exitCode` in `proof.json`:

| Exit | Route to | Use from `proof.json` |
| --- | --- | --- |
| 0 | a person for print approval. MergeProof checks text only, not layout or fonts | `summary` |
| 1 | inspecting the flagged pages. Do not approve automatically | `page` / `pages` in `pageIssues`, `fieldMismatches`, `duplicateIds` and `unknownIds`, plus `missingIds[].seenOnInvalidPages` and `hints` |
| 2 | fixing the inputs (CSV, map, PDF path or `pdftotext`), then rerunning | `error.kind` and `error.message` |

An agent should treat exit 0 as "ready for a person to review", not as approval to print, and should not edit the CSV or map just to make a proof pass.

## How it works and what it does not do

- The PDF is read with `pdftotext -enc UTF-8 -eol unix <absolute path> -`. It runs as a child process with literal arguments and no shell, so paths with spaces or shell characters are safe. Pages are split on pdftotext's form feeds, which keeps physical page numbers.
- Limits: pdftotext output is capped at 64 MiB and its run time at 120 seconds. Beyond either, MergeProof stops with exit status 2 and asks you to proof smaller batches. The map may be up to 1 MiB and the CSV up to 256 MiB.
- Not checked in this beta: fonts and font substitution, visual design, colour, images, geometry and layout (including overset or clipped text), barcodes, OCR and scanned pages, whether hidden text is correct, more than one record per page, arbitrary PDF templates, and templates where labels and values are in separate columns that pdftotext reads apart.
- Intentionally blank pages count as unreadable, because MergeProof cannot tell them apart from image-only pages.
- pdftotext's reading-order mode may join a line that ends in a hyphen to the next line. Avoid printing the ID, a label or the end marker at the end of a line that ends with `-`. In that case the record fails rather than passing silently.
- An independent clean-checkout test on macOS arm64 with Poppler 26.04 ran all 101 tests on Node.js 22.23.5 and 26.0.0, and they passed on both. That testing used the synthetic samples. Linux and real production exports have not been verified yet. Please report what you find.

## Development

```sh
npm ci
npm test
```

The tests use Node's built-in runner. They cover the parser, CSV, map, normalization, reconciliation, report and `--show-text` units against literal text, and run real Poppler extraction and the CLI end to end on generated PDFs in temporary folders whose names contain spaces. `pdftotext` must be installed for the extraction and CLI tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the project's conventions.

```
bin/mergeproof.js      CLI entry (checks the Node version)
src/cli.js             argument parsing (node:util parseArgs), orchestration, exit codes
src/errors.js          exit codes, InputError and UsageError
src/files.js           read-only input checks and strict UTF-8 reading
src/extract.js         pdftotext child process, limits, page splitting
src/normalize.js       NFC and whitespace rules shared by IDs, values and labels
src/page.js            page text -> record, no-record or page issue
src/csv.js             CSV loading and ID validation (csv-parse)
src/mapping.js         defensive map parsing
src/reconcile.js       ID join, field comparison and hints
src/report.js          text and JSON output
src/show-text.js       --show-text listing
fixtures/pdf-writer.js minimal PDF 1.4 writer (Courier, WinAnsiEncoding, escaped/octal literals)
fixtures/samples.js    synthetic sample data and the clean/broken page layouts
fixtures/generate.js   writes samples/ (npm run sample)
test/                  unit, real-extraction and CLI tests
site/                  static project page
```

## License and third-party software

MergeProof's own code, tests, fixtures and site are released under the [MIT License](LICENSE). The sample data is invented.

- [csv-parse](https://csv.js.org/parse/) (MIT) is the only runtime dependency. `npm ci` downloads it into `node_modules/`. It is not included in this repository.
- Poppler's `pdftotext` (GPL) is a separate program that you install yourself. MergeProof runs it as an external command and does not include or link any Poppler code.
