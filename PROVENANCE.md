# Provenance

`@cubiczan/finance-engines` is a TypeScript port, by the same author, of three
Python engines from the author's own repositories. Those repositories are
published without any open-source license (all rights reserved), and the
author (Shyam Desigan / Cubiczan) holds full copyright in both the originals
and this port. No third-party code was copied into this package.

| Engine (this package) | Donor repository | Ported components |
|---|---|---|
| `src/margin/` | `icohangar-ops/commodity-margin-engine` (unlicensed, all rights reserved) | `marginengine/engine.py` (product economics, sensitivity, breakeven, price CSV loader), `marginengine/contracts.py` (grade multiplier, discount + profit share, collar, assay payables), `config/margin.yaml` + `config/prices_sample.csv` (as typed defaults), `tests/test_engine.py`, `tests/test_contracts.py` |
| `src/covenant/` | `icohangar-ops/covenant-compliance-tracker` (unlicensed, all rights reserved) | `covtracker/engine.py` (trial-balance parsing, covenant metrics, evaluation, certificate markdown), `config/covenants.yaml` (as typed default), `fixtures/reports_trialbalance.json`, `tests/test_engine.py` |
| `src/audit/` | `icohangar-ops/invoice-audit-engine` (unlicensed, all rights reserved) | `auditengine/rules.py` (all eight anomaly rules + `normalize_number`), reimplemented over in-memory arrays instead of SQLite, `tests/test_rules.py` |
| `src/audit/exceptions.ts`, `src/close/` | original to this package (not a Python port) | AP exception taxonomy (reuses duplicate/tax rules), five-day close readiness/workflow, operator metrics, example fixture |

Integration code from the donor repos that touches external services (Xero,
Precoro, AlphaVantage, web UIs, SQLite persistence) was deliberately **not**
ported: this package contains only the deterministic, offline engine cores and
their MCP tool surface.

This package is proprietary; see [LICENSE.md](./LICENSE.md).
