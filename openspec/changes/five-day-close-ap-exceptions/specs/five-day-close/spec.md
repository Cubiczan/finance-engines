# five-day-close

## ADDED Requirements

### Requirement: Six-gate reference workflow

`runFiveDayClose` SHALL evaluate six gates in a configurable close window
(default 120 hours): source freeze, subledger cutoffs, reconciliation
queue, evidence bundle, exception SLA, and controller sign-off.

#### Scenario: Frozen extracts

- **GIVEN** `freeze_at` and extracts all taken at or before freeze
- **WHEN** the workflow runs
- **THEN** the source-freeze gate is `complete`

### Requirement: Close-readiness helper

`assessCloseReadiness` SHALL inventory systems and extracts, mark stale
inputs against an injectable `now`, report reconciliation coverage, and
compute hours-to-close from freeze (or earliest extract) to sign-off or
`now`.

#### Scenario: Stale extract

- **GIVEN** an extract older than `stale_after_hours` relative to `now`
- **WHEN** readiness is assessed
- **THEN** that extract appears in `stale_inputs` and raises
  `stale_input_rate`

### Requirement: Operator metrics

The workflow SHALL return `straight_through_rate`,
`double_handling_minutes` (from the synthetic per-code table plus extra
touches), `stale_input_rate`, and `hours_to_close`.

#### Scenario: Mixed corpus

- **GIVEN** some exception-free invoices and some classified exceptions
- **WHEN** metrics are computed
- **THEN** straight-through rate equals exception-free invoices / total
  invoices (zero invoices → 1)

### Requirement: Optional covenant evidence

When a trial balance is supplied, the workflow SHALL evaluate covenants
with the existing engine and attach a compliance certificate to the
evidence bundle. Existing covenant MCP tools SHALL keep their contracts.

#### Scenario: Trial balance supplied

- **GIVEN** a parsed trial balance and period label
- **WHEN** `runFiveDayClose` runs
- **THEN** the report includes covenant metrics/results/certificate and
  an evidence artifact of kind `covenant_certificate`

### Requirement: Deterministic clock

Hours, staleness, and SLA checks SHALL use caller-supplied timestamps
(`now`, `freeze_at`, extract times). The engine SHALL NOT read the
system clock when `now` is provided.

#### Scenario: Synthetic timestamps

- **GIVEN** fixture timestamps
- **WHEN** the workflow runs on two machines
- **THEN** hours-to-close and stale flags match
