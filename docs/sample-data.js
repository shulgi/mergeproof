// Captured from MergeProof CLI with its checked-in synthetic sample generator.
const mergeproofSamples = {
  "broken": {
    "terminal": "MergeProof FAIL: 10 findings\n  9 pages, 6 CSV rows, 0 records verified (5 fields each)\n\nPage issues (3)\n  page 7: unreadable - no extractable text (blank page, scanned image or outlined text)\n  page 8: invalid boundary - end marker \"END OF RECORD\" not found after \"Member ID:\" (ID \"KX 9\")\n  page 9: ambiguous - record start label \"Member ID:\" appears 2 times (IDs \"Ö-17\", \"a-0310\")\n\nField mismatches (2)\n  page 2, ID \"00042\", Balance: expected \"€1,250.00\", found \"€1,205.00\"\n  page 3, ID \"00107\", Postcode: expected \"114 51\", but label \"Postcode:\" is not in the record block\n\nDuplicate PDF IDs (1)\n  ID \"A-0310\" on pages 4, 5\n\nUnknown PDF IDs (1)\n  page 6: ID \"Z-999\" is not in the CSV\n\nMissing CSV IDs (3)\n  ID \"a-0310\" (CSV data row 4) was not verified on any page; seen on unverified page 9\n  ID \"KX 9\" (CSV data row 5) was not verified on any page; seen on unverified page 8\n  ID \"Ö-17\" (CSV data row 6) was not verified on any page; seen on unverified page 9\n\nPages without a record (not findings): 1",
    "report": {
      "tool": "mergeproof",
      "schemaVersion": 1,
      "status": "fail",
      "exitCode": 1,
      "inputs": {
        "csv": "samples/records.csv",
        "pdf": "samples/proof-broken.pdf",
        "map": "samples/map.json"
      },
      "summary": {
        "pages": 9,
        "csvRows": 6,
        "fieldsPerRecord": 5,
        "recordPages": 5,
        "verifiedRecords": 0,
        "findings": 10,
        "pageIssues": 3,
        "fieldMismatches": 2,
        "duplicateIds": 1,
        "unknownIds": 1,
        "missingIds": 3,
        "pagesWithoutRecord": 1
      },
      "pageIssues": [
        {
          "page": 7,
          "kind": "unreadable",
          "message": "no extractable text (blank page, scanned image or outlined text)",
          "ids": []
        },
        {
          "page": 8,
          "kind": "invalid-boundary",
          "message": "end marker \"END OF RECORD\" not found after \"Member ID:\"",
          "ids": [
            "KX 9"
          ]
        },
        {
          "page": 9,
          "kind": "ambiguous",
          "message": "record start label \"Member ID:\" appears 2 times",
          "ids": [
            "Ö-17",
            "a-0310"
          ]
        }
      ],
      "fieldMismatches": [
        {
          "page": 2,
          "id": "00042",
          "column": "Balance",
          "label": "Balance:",
          "expected": "€1,250.00",
          "extracted": "€1,205.00",
          "problem": "value-differs"
        },
        {
          "page": 3,
          "id": "00107",
          "column": "Postcode",
          "label": "Postcode:",
          "expected": "114 51",
          "extracted": null,
          "problem": "label-missing"
        }
      ],
      "duplicateIds": [
        {
          "id": "A-0310",
          "pages": [
            4,
            5
          ],
          "inCsv": true
        }
      ],
      "unknownIds": [
        {
          "page": 6,
          "id": "Z-999"
        }
      ],
      "missingIds": [
        {
          "id": "a-0310",
          "csvRow": 4,
          "seenOnInvalidPages": [
            9
          ]
        },
        {
          "id": "KX 9",
          "csvRow": 5,
          "seenOnInvalidPages": [
            8
          ]
        },
        {
          "id": "Ö-17",
          "csvRow": 6,
          "seenOnInvalidPages": [
            9
          ]
        }
      ],
      "pagesWithoutRecord": [
        1
      ],
      "hints": []
    }
  },
  "clean": {
    "terminal": "MergeProof PASS: 0 findings\n  7 pages, 6 CSV rows, 6 records verified (5 fields each)\n\nPages without a record (not findings): 1",
    "report": {
      "tool": "mergeproof",
      "schemaVersion": 1,
      "status": "pass",
      "exitCode": 0,
      "inputs": {
        "csv": "samples/records.csv",
        "pdf": "samples/proof-clean.pdf",
        "map": "samples/map.json"
      },
      "summary": {
        "pages": 7,
        "csvRows": 6,
        "fieldsPerRecord": 5,
        "recordPages": 6,
        "verifiedRecords": 6,
        "findings": 0,
        "pageIssues": 0,
        "fieldMismatches": 0,
        "duplicateIds": 0,
        "unknownIds": 0,
        "missingIds": 0,
        "pagesWithoutRecord": 1
      },
      "pageIssues": [],
      "fieldMismatches": [],
      "duplicateIds": [],
      "unknownIds": [],
      "missingIds": [],
      "pagesWithoutRecord": [
        1
      ],
      "hints": []
    }
  }
};
