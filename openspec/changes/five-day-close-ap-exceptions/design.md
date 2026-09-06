# Design: Five-day close + AP exceptions

## Constraints

- Pure functions, no network, no clocks except an injectable `now` /
  `today`.
- Do not change `runAllAuditRules` finding shape (parity + existing MCP).
- UNLICENSED — leave `LICENSE.md` alone.

## AP exceptions

New module `src/audit/exceptions.ts`.

`ApInvoiceRow` extends `InvoiceRow` with optional match fields (`po_number`,
`expected_po_number`, `po_amount`, `receipt_id`, `receipt_required`,
quantities, legal entities, tax codes, `tax_review_required`,
`approval_owner`, `requires_approval`, `source_system`). Invoices that omit
these fields only participate in duplicate (and optional tax) reuse.

`classifyApExceptions(invoices, items, cfg)`:

1. Reuse `duplicateNumbers` — emit one `duplicate_invoice` per member of
   a colliding group (`DUP-NORM-COLLISION`).
2. Reuse `inconsistentTax` when enabled — map to `tax_review` /
   `TAX-INCONSISTENT`.
3. New deterministic checks for the remaining codes.

Reason codes are stable strings. Confidence is a fixed table plus a
small deterministic adjustment (e.g. duplicate raw-number collision is
higher than normalized-only collision).

`runInvoiceReview` returns `{ findings, exceptions }` so agents can call
both engines without changing `audit_invoices`.

Synthetic double-handling minutes live in a documented per-code table.
Extra minutes apply when an invoice has more than one exception or
`handling_touches > 1`.

## Five-day close

New module family `src/close/`.

Six gates inside a 120-hour (default) window:

| Gate | Day | Complete when |
|---|---|---|
| Source freeze | 1 | `freeze_at` set and every extract `extracted_at <= freeze_at` |
| Subledger cutoffs | 1 | Each required system has each required subledger frozen |
| Reconciliation queue | 2 | Item coverage meets threshold and no `open` items (or coverage-only if configured) |
| Evidence bundle | 3 | Required artifact kinds present (extract, reconciliation, exception_queue); covenant cert generated when a trial balance is supplied |
| Exception SLA | 4 | No open exception past `opened_at + sla_hours` |
| Controller sign-off | 5 | Prior gates complete and `signed_at` set; optional block if covenants breach |

`assessCloseReadiness` is the helper (inventory, stale inputs, coverage,
hours-to-close). `runFiveDayClose` classifies exceptions if needed,
assembles evidence, evaluates optional covenants, and returns gates +
metrics.

Hours-to-close = (`signed_at` or `now`) − (`freeze_at` or earliest extract).

Stale = `(now − extracted_at) hours > stale_after_hours` (default 36).

Straight-through rate = invoices with zero exceptions / invoice count.

## MCP

Additive tools only: `classify_ap_exceptions`, `close_readiness`,
`five_day_close`. Existing tools and `uipath_handoff` kinds stay valid.
Optional new handoff kinds may be added; they must not rename or remove
`audit_invoices` / `compliance_certificate` / `evaluate_contracts`.

## Example

`examples/five-day-close/` holds a synthetic multi-ERP fixture (NetSuite,
SAP, Xero) and a runner. README cookbook states what is illustrative
(timestamps, handling minutes, SLA hours, fixture entities) vs what is
the deterministic engine.

## Testing

New `node:test` files import from `dist/index.js`, matching existing
style. Existing audit/covenant/margin/MCP suites must stay green. Do not
hand-edit golden vectors.
