# ap-exceptions

## ADDED Requirements

### Requirement: Exception taxonomy

The library SHALL classify AP invoices into the codes `duplicate_invoice`,
`missing_po`, `mismatched_po`, `missing_receipt`, `wrong_legal_entity`,
`tax_review`, and `ownerless_approval`. Each exception SHALL include a
stable `reason_code`, a `confidence` in `[0, 1]`, severity, and a
human-readable detail string.

#### Scenario: Published catalog

- **GIVEN** a caller asks for the taxonomy
- **WHEN** they invoke `apExceptionTaxonomy`
- **THEN** every code above is listed with its reason codes and
  synthetic handling minutes

### Requirement: Reuse invoice-audit duplicates

Duplicate detection SHALL reuse `duplicateNumbers` / `normalizeInvoiceNumber`
rather than a second normalization scheme. `runAllAuditRules` output SHALL
remain unchanged.

#### Scenario: Normalized collision

- **GIVEN** two invoices for the same supplier whose numbers normalize
  together (`INV100` and `#INV100`)
- **WHEN** `classifyApExceptions` runs
- **THEN** each invoice receives `duplicate_invoice` with reason
  `DUP-NORM-COLLISION`

### Requirement: Match-context rules

When optional match fields are present, the classifier SHALL emit:

- `missing_po` / `PO-ABSENT` when a PO is required and absent
- `mismatched_po` / `PO-NUMBER-MISMATCH` or `PO-AMOUNT-MISMATCH`
- `missing_receipt` / `RCV-ABSENT` or `RCV-QTY-SHORT`
- `wrong_legal_entity` / `LE-MISMATCH`
- `tax_review` / `TAX-CODE-MISMATCH`, `TAX-FLAG-REVIEW`, or
  `TAX-INCONSISTENT`
- `ownerless_approval` / `APPR-NO-OWNER`

Invoices that omit match fields SHALL not be flagged for those rules.

#### Scenario: Clean invoice without match fields

- **GIVEN** a unique invoice with no PO/receipt/entity/approval fields
- **WHEN** classification runs
- **THEN** it contributes to straight-through rate and has no exceptions

### Requirement: Deterministic and offline

Classification SHALL be a pure function of invoices, items, and config.
It SHALL NOT perform network I/O.

#### Scenario: Same inputs

- **GIVEN** a fixed corpus
- **WHEN** classification runs twice
- **THEN** the exception lists are deeply equal
