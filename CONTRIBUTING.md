# Contributing to MergeProof

Thanks for helping. MergeProof is a small beta with a deliberately narrow job: reconcile the text of a merged PDF with its CSV, locally and deterministically. Please open an issue to discuss larger changes, especially ones that widen the scope (visual or font checks, OCR, multi-record pages), before writing code.

## Setup

You need Node.js 22+ and Poppler's `pdftotext` (see the README).

```sh
npm ci
npm test
npm run sample && npm run proof:clean
```

## Conventions

- **No network, no telemetry.** The CLI reads local files and runs `pdftotext` with literal arguments and no shell. Keep it that way.
- **Inputs are read-only.** Nothing may open the CSV, map or PDF for writing.
- **Exit codes are a contract.** 0 means a clean proof, 1 means findings, 2 means unusable invocation or input. Throw `InputError` (or `UsageError` for command-line problems) from `src/errors.js` for anything that makes a proof impossible. Never report an input error as a finding.
- **No silent passes.** A page that cannot be read unambiguously must be reported, never treated as correct.
- **Error messages** name the file or option, say what is wrong and, where possible, how to fix it.
- **Dependencies:** csv-parse is the only runtime dependency. Avoid adding more. Any new dependency must have a license compatible with MIT.
- **Style:** Node ESM, built-in modules where possible, and small pure functions that can be tested on literal text. Source files stay ASCII where practical. Build special characters from code points (see `test/helpers.js`).

## Tests

- Unit tests use literal page text and need no Poppler.
- `test/extract.test.js` and `test/cli.test.js` run the real `pdftotext` on PDFs from `fixtures/pdf-writer.js`, in temporary folders with spaces in their names.
- Add a regression test with every fix. If you change the sample fixtures, update the expected findings in the README and `test/cli.test.js` together.
- Fixtures must be original and synthetic. Do not commit real customer data, real PDFs or third-party fonts.

## Licensing

By contributing, you agree that your contribution is released under the project's [MIT License](LICENSE).
