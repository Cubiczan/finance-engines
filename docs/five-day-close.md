# Five-day close reference

`runFiveDayClose` evaluates six gates inside a configurable window
(default **120 hours**). `assessCloseReadiness` is the helper that
inventories systems, flags stale extracts, reports reconciliation
coverage, and computes hours-to-close.

All clocks are caller-supplied (`now`, `freeze_at`, extract times,
`signed_at`). When `now` is provided the engine does not read the
system clock.

## Gates

| Day | Gate | Complete when |
|---|---|---|
| 1 | Source freeze | `freeze_at` set; every extract `extracted_at <= freeze_at` |
| 1 | Subledger cutoffs | Each required system has each required subledger (`ap`, `ar`, `inventory`, `cash` by default) frozen |
| 2 | Reconciliation queue | Coverage meets threshold and no `open` items (when `require_recs_cleared`, default true) |
| 3 | Evidence bundle | Kinds `extract`, `reconciliation`, `exception_queue` present (generated from the payload if omitted) |
| 4 | Exception SLA | No **open** exception with `now > opened_at + sla_hours` (default 48h; `opened_at` defaults to `freeze_at`) |
| 5 | Controller sign-off | Prior gates complete and `signoff.signed_at` set. Covenant breach blocks sign-off when a trial balance is supplied (`block_signoff_on_covenant_breach`, default true) |

## Metrics

| Metric | Definition |
|---|---|
| `straight_through_rate` | Invoices with zero AP exceptions / invoice count (0 invoices → 1) |
| `double_handling_minutes` | Synthetic: extra exception codes on the same invoice + `(handling_touches − 1) × retouch minutes` |
| `stale_input_rate` | Sources with age > `stale_after_hours` (default 36) or missing required systems / source count |
| `hours_to_close` | (`signed_at` or `now`) − (`freeze_at` or earliest extract) |

These metrics measure **exception leakage and input freshness**, not OCR
volume.

## Covenant wiring

When `trial_balance` is present, the existing covenant engine computes
metrics, evaluates thresholds, and attaches a `covenant_certificate`
evidence artifact. The `compliance_certificate` MCP tool is unchanged.

## Runnable fixture

```bash
npm run example:close
```

See [examples/five-day-close](../examples/five-day-close) and the README
cookbook for illustrative vs production boundaries.
