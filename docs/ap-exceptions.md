# AP exception taxonomy

Deterministic procure-to-pay exception codes used by `classifyApExceptions`.
Confidence and reason codes are tables, not model scores. Handling minutes
are synthetic defaults for close metrics.

Duplicate detection **reuses** `duplicateNumbers` / `normalizeInvoiceNumber`
from the invoice-audit engine. `runAllAuditRules` output is unchanged.

| Code | Reason code | When it fires | Default confidence | Synthetic minutes |
|---|---|---|---|---|
| `duplicate_invoice` | `DUP-NORM-COLLISION` | Same supplier + normalized invoice number (audit rule reused) | 0.99 exact raw match; 0.90 normalized-only | 15 |
| `missing_po` | `PO-ABSENT` | `requires_po` or `expected_po_number` set, and `po_number` empty | 0.99 | 25 |
| `mismatched_po` | `PO-NUMBER-MISMATCH` | `po_number` ≠ `expected_po_number` (alphanumeric, case-insensitive) | 0.95 | 30 |
| `mismatched_po` | `PO-AMOUNT-MISMATCH` | `\|sum − po_amount\| / po_amount` above `po_amount_tolerance_pct` (default 1%) | 0.70 + deviation (capped 0.99) | 30 |
| `missing_receipt` | `RCV-ABSENT` | `receipt_required` and no `receipt_id` | 0.93 | 20 |
| `missing_receipt` | `RCV-QTY-SHORT` | `billed_qty` > `received_qty` | 0.86 | 20 |
| `wrong_legal_entity` | `LE-MISMATCH` | `legal_entity` ≠ `expected_legal_entity` | 0.99 | 40 |
| `tax_review` | `TAX-CODE-MISMATCH` | `tax_code` ≠ `expected_tax_code` | 0.92 | 35 |
| `tax_review` | `TAX-FLAG-REVIEW` | `tax_review_required` | 1.00 | 35 |
| `tax_review` | `TAX-INCONSISTENT` | Reused `inconsistentTax` finding | 0.88 | 35 |
| `ownerless_approval` | `APPR-NO-OWNER` | `requires_approval` and no `approval_owner` | 0.97 | 20 |

Invoices that omit match-context fields are **not** flagged for PO, receipt,
entity, tax-code, or approval rules. They still participate in duplicate
(and optional inconsistent-tax) reuse.

`runInvoiceReview(invoices, items, cfg)` returns `{ findings, exceptions }`
so an agent can call both engines without changing `audit_invoices`.

Catalog at runtime: `apExceptionTaxonomy()`.
