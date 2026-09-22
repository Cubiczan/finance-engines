# @cubiczan/finance-engines

**Deterministic finance engines for AI agents: commodity margins, loan
covenants, invoice audit, AP exceptions, and five-day close — as a
TypeScript library and a licensed MCP server.**

LLM agents are good at judgment and bad at arithmetic. This package gives them
the arithmetic: pure, offline, fully deterministic engines that always
return the same numbers for the same inputs — no network, no state, no
hallucinated math. Use them directly from TypeScript/JavaScript, or hand them
to any MCP-compatible agent (Claude Code, Claude Desktop, Cursor, custom
agents) as a stdio tool server.

> **Commercial software.** `UNLICENSED` — all rights reserved. Use requires a
> commercial agreement: **sam@cubiczan.com**. See [LICENSE.md](./LICENSE.md)
> and [PROVENANCE.md](./PROVENANCE.md).

## Engines

- **Margin** — index-linked product economics for commodity processors (e.g.
  battery recycling): revenue/margin per tonne from assay x payable x index
  price, inventory mark-to-market, shock-grid price sensitivity, breakeven
  prices, and config-driven contract structures (grade multiplier, discount +
  profit share, collar, assay payables).
- **Covenant** — loan covenant monitoring: parse a trial balance (Xero payload
  or plain records), compute EBITDA / DSCR / current ratio / leverage /
  liquidity, evaluate against covenant thresholds with headroom, and render a
  signable markdown compliance certificate.
- **Audit** — vendor-invoice anomaly detection for procure-to-pay: duplicate
  invoice numbers, entry lag, overdue-unpaid, amount outliers, unit-rate
  changes, new charge types, unexplained credits, inconsistent tax.
- **Close** — multi-ERP five-day-close readiness (source freeze, subledger
  cutoffs, reconciliation queue, evidence bundle, exception SLA, controller
  sign-off) plus an AP exception taxonomy with confidence and reason codes.
  Operator metrics: straight-through rate, synthetic double-handling minutes,
  stale-input rate, hours-to-close.

## Quickstart — library

```bash
npm install @cubiczan/finance-engines
```

```ts
import {
  productEconomics, sensitivity, breakevenPrices, evaluateAllContracts,
  parseXeroTrialBalance, computeMetrics, evaluateCovenants, certificateMarkdown,
  runAllAuditRules, normalizeInvoiceNumber,
  classifyApExceptions, runFiveDayClose, assessCloseReadiness,
  defaultMarginConfig, defaultCovenantConfig,
} from "@cubiczan/finance-engines";

// Margins: bring your own config/prices, or use the bundled defaults
const prices = { LI2CO3: 12000, "LME-NI": 16000, "LME-CO": 34000, "LME-CU": 9600 };
const econ = productEconomics(defaultMarginConfig, prices);
const grid = sensitivity(defaultMarginConfig, prices, "black_mass");
const be = breakevenPrices(defaultMarginConfig, prices, "black_mass");
const contracts = evaluateAllContracts(defaultMarginConfig, prices);

// Covenants: trial balance -> metrics -> evaluation -> certificate
const tb = parseXeroTrialBalance(xeroTrialBalanceJson);
const metrics = computeMetrics(tb, defaultCovenantConfig);
const results = evaluateCovenants(metrics, defaultCovenantConfig);
const certificate = certificateMarkdown(results, metrics, "Q2 2026");

// Invoice audit: plain rows in, findings out
const findings = runAllAuditRules(invoiceRows, itemRows, { today: "2026-07-03" });
normalizeInvoiceNumber("#INV20481"); // -> "20481"

// AP exceptions + five-day close: see the cookbook below
const exceptions = classifyApExceptions(invoiceRows, itemRows);
const close = runFiveDayClose(closePayload); // period, now, freeze_at, sources, …
```

The engine core has **zero runtime dependencies** (the MCP SDK is only loaded
by the server entry point).

UiPath can hand invoice rows, trial balances, or contract payloads to the same deterministic tools through the `uipath_handoff` MCP tool or directly into the library.

## Procurement-profitability integration contract

The package exports a type-only boundary for callers that coordinate covenant
checks, invoice audit, AP exceptions, and a five-day close:

```ts
import {
  type CovenantCheckInput,
  type InvoiceAuditInput,
  type APExceptionsInput,
  type FiveDayCloseInput,
  type ProcurementProfitabilityAdapter,
} from "@cubiczan/finance-engines";

const adapter: ProcurementProfitabilityAdapter = {
  checkCovenant: (input: CovenantCheckInput) => {
    // Call parse/compute/evaluate/certificate from this package here.
    return callerOwnedCovenantResult(input);
  },
  auditInvoices: (input: InvoiceAuditInput) => callerOwnedInvoiceAudit(input),
  reviewAPExceptions: (input: APExceptionsInput) => callerOwnedAPReview(input),
  assessFiveDayClose: (input: FiveDayCloseInput) => callerOwnedCloseReview(input),
};
```

`CovenantCheckInput`/`Output` and `InvoiceAuditInput`/`Output` use the package's
existing typed engine rows and results. `APExceptions*` and `FiveDayClose*`
describe caller-owned workflow data; this package does not persist, fetch, or
resolve those records. Every contract carries `provenance.invocation: "dependency"`
to make that boundary explicit. This example is an integration contract only:
callers must have a commercial license and must depend on this package rather
than copy its internals. See [LICENSE.md](./LICENSE.md) and
[PROVENANCE.md](./PROVENANCE.md).

## Quickstart — MCP server

The package ships a stdio MCP server as the `finance-engines-mcp` binary.

```bash
# Claude Code
claude mcp add finance-engines -- npx -y @cubiczan/finance-engines finance-engines-mcp
# or, with the package installed:
claude mcp add finance-engines -- finance-engines-mcp
```

Or in a generic MCP client config:

```json
{
  "mcpServers": {
    "finance-engines": {
      "command": "npx",
      "args": ["-y", "@cubiczan/finance-engines", "finance-engines-mcp"]
    }
  }
}
```

All tools are deterministic and offline. Where `config`/`prices` are optional,
bundled sample defaults apply — supply your own to price your own book.

## MCP tools

| Tool | Engine | What it does |
|---|---|---|
| `product_margins` | margin | Revenue, cost, and margin per MT per product, with metal contributions and inventory mark |
| `price_sensitivity` | margin | Margin/MT scenario grid under uniform and per-metal price shocks |
| `breakeven` | margin | Implied per-metal index prices at which a product's margin hits zero |
| `evaluate_contracts` | margin | Evaluate grade-multiplier / profit-share / collar / assay-payables contract structures at spot |
| `parse_trial_balance` | covenant | Flatten a Xero Reports/TrialBalance payload into netted section balances |
| `compute_covenant_metrics` | covenant | EBITDA, DSCR, current ratio, leverage, liquidity, etc. from a trial balance |
| `evaluate_covenants` | covenant | Test metrics against covenant thresholds with % headroom |
| `compliance_certificate` | covenant | End-to-end signable markdown covenant certificate for a period |
| `audit_invoices` | audit | Run all eight invoice anomaly rules over supplied invoice/item rows |
| `normalize_invoice_number` | audit | Canonicalize an invoice number for duplicate detection |
| `classify_ap_exceptions` | audit | AP exception taxonomy with confidence + reason codes (reuses duplicate/tax rules) |
| `close_readiness` | close | Inventory extracts, stale inputs, reconciliation coverage, hours-to-close |
| `five_day_close` | close | Six-gate five-day close + metrics; optional covenant evidence |
| `uipath_handoff` | UiPath | Route a UiPath payload to invoice audit, covenant certificate, contract evaluation, AP exceptions, or five-day close |

## Development

```bash
npm install
npm run build          # tsc -> dist/
npm test               # builds, then runs all suites + MCP smoke test (node --test)
npm run example:close  # multi-ERP five-day close fixture
```

The test suites mirror the donor Python test suites number-for-number (same
fixtures, same hand-computed expectations), proving the ports equivalent.

## Cookbook — five-day close + AP exceptions

PE-style close pressure (multiple ERPs, five-day clock, AP exceptions killing
straight-through rate) is the operator problem this example is built against.
The engines stay offline and deterministic; they do **not** talk to NetSuite,
SAP, or Xero.

```bash
npm run example:close
# or, after a build:
node examples/five-day-close/run.mjs
```

The fixture (`examples/five-day-close/fixture.json`) is a synthetic June 2026
close across three ERPs:

| System | ERP | Entity |
|---|---|---|
| `netsuite-us` | NetSuite | US HoldCo |
| `sap-de` | SAP | DE OpCo GmbH |
| `xero-uk` | Xero | UK Shared Services Ltd |

It walks the six gates — source freeze, subledger cutoffs, reconciliation
queue, evidence bundle, exception SLA, controller sign-off — and classifies
the AP corpus (duplicates reuse `normalizeInvoiceNumber`; plus missing /
mismatched PO, missing receipt, wrong legal entity, tax review, ownerless
approval).

Library equivalent:

```ts
import { readFileSync } from "node:fs";
import { runFiveDayClose, classifyApExceptions, apExceptionTaxonomy } from "@cubiczan/finance-engines";

const payload = JSON.parse(readFileSync("examples/five-day-close/fixture.json", "utf8"));
const report = runFiveDayClose(payload);
// report.gates, report.metrics, report.exceptions, report.covenant, report.signoff_ready
```

Pass the same payload to MCP tools `five_day_close` / `close_readiness`
(`{ "close": { …payload } }`) or `classify_ap_exceptions`.

### Illustrative vs production

**Deterministic engine (this package)**

- Gate status, stale flags, coverage, hours-to-close, exception codes /
  reason codes / confidence, and the four operator metrics — given the
  same payload, every run returns the same JSON.
- Duplicate detection is the existing audit normalizer, not a second scheme.
- Covenant flash, when a trial balance is supplied, is the existing covenant
  engine (same certificate markdown).

**Illustrative only (do not treat as measured ops data)**

- Every timestamp in the fixture (`now`, `freeze_at`, extract times, SLA
  clocks). Production should inject real freeze/extract/sign-off times.
- Double-handling **minutes** — a published synthetic table
  (`DEFAULT_HANDLING_MINUTES` + retouch minutes), not stopwatch data.
- Entity names, checksums, invoice amounts, and the mid-close “blocked”
  story (stale Xero extract, open intercompany rec, past-SLA exceptions,
  DSCR breach).
- No ERP connector, OCR, workflow engine, or system of record. Straight-
  through rate here is **exception-free invoices / invoices**, not OCR
  capture rate.

Taxonomy: [docs/ap-exceptions.md](./docs/ap-exceptions.md).  
Gates and metrics: [docs/five-day-close.md](./docs/five-day-close.md).

---

Copyright (c) 2026 Shyam Desigan (Cubiczan). All rights reserved.
