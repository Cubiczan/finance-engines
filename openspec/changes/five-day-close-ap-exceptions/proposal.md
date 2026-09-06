# Change: Five-day close + AP exceptions

## Why

PE-backed operators are asked for a five-day close across multiple ERPs.
AP automation fails on exceptions, and straight-through rate matters more
than OCR volume. This package already has deterministic invoice-audit and
covenant engines; it lacks a close-readiness workflow and an AP exception
taxonomy that agents can run offline.

## What changes

- Add an AP exception classifier that **extends** existing invoice-audit
  rules (duplicates, inconsistent tax) with PO, receipt, legal-entity,
  tax-review, and ownerless-approval checks. Each exception carries a
  confidence and a reason code.
- Add a five-day close reference workflow: source freeze, subledger
  cutoffs, reconciliation queue, evidence bundle, exception SLA,
  controller sign-off.
- Add a close-readiness helper: inventory systems/extracts, stale-input
  detection, reconciliation coverage, hours-to-close (injectable clock).
- Emit operator metrics: straight-through rate, synthetic double-handling
  minutes, stale-input rate, hours-to-close.
- Optionally attach a covenant certificate to the evidence bundle when a
  trial balance is supplied.
- Ship a multi-ERP runnable fixture + cookbook. Add MCP tools without
  changing existing tool names or contracts.

## Out of scope

- Live ERP connectors, OCR, or network I/O in the engine core
- License changes
- Rewriting the eight existing audit rules or golden-vector parity suite
- A production close system of record

## Capabilities

- `ap-exceptions` (new)
- `five-day-close` (new)
- `invoice-audit` (delta: reuse duplicates/tax; do not change `runAllAuditRules` output)
