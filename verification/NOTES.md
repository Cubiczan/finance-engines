# Finance.lean — mapping and findings

Model: `verification/Finance.lean` (Lean 4.34.1, core library only).
Compiles with `~/.elan/bin/lean Finance.lean`, exit 0, no warnings.
No `sorry`/`admit`/custom axioms — `#print axioms` on the headline
theorems shows only `propext`, `Classical.choice`, `Quot.sound`.

The code was followed wherever it differs from the docs
(`docs/five-day-close.md`, `openspec/specs/five-day-close/spec.md`);
divergences are itemised below. JS numbers are IEEE-754 doubles; the
model uses exact `Rat`, and float-specific behaviour is flagged, not
proved.

## Theorem → source mapping

### Covenant evaluation — `src/covenant/engine.ts`

| Lean | Source | What it says |
|---|---|---|
| `Op`, `opOf`, `opOf_ne_ge` | l. 239–240 | Only the exact string `">="` selects the `>=` branch; every other operator string is treated as `<=`. |
| `compliantB`, `compliantB_ge`, `compliantB_le` | l. 240 | The compliance test itself. |
| `breach_ge_sound`, `breach_le_sound` | l. 240 | **Soundness**: a reported BREACH means the metric really is strictly past the threshold, in the operator's direction. |
| `compliantB_ge_false`, `compliantB_le_false` | l. 240 | BREACH ⟺ strict violation (boundary value = threshold is compliant for both operators). |
| `headroom`, `headroom_sign_iff` | ll. 241–245 | **Headroom sign is correct** for threshold ≠ 0: headroom ≥ 0 ⟺ compliant, both directions. |
| `headroom_ge_eq_zero_iff`, `headroom_le_eq_zero_iff` | ll. 241–245 | At threshold ≠ 0, headroom = 0 ⟺ metric exactly on the threshold. |
| `headroom_zero_threshold`, `headroom_zero_threshold_breach_example` | l. 241 | Threshold = 0 ⇒ headroom is defined as 0 — even on a breach (proved by a concrete counterexample). |
| `valueOf`, `valueOf_missing` | l. 237 | Missing metric defaults to `0.0` (`?? 0.0`). |
| `missing_metric_le_passes` | l. 237 + l. 240 | A `<=` covenant with a **missing** metric and threshold ≥ 0 reports COMPLIANT. |
| `missing_metric_ge_breaches` | l. 237 + l. 240 | A `>=` covenant with a missing metric and threshold > 0 reports BREACH (fail-closed dual). |
| `currentRatio`, `currentRatio_zero_denominator`, `zero_current_liabilities_breach` | l. 222 | Zero current liabilities ⇒ ratio 0 ⇒ breach of any positive `>=` current-ratio covenant. |
| `dscr`, `dscr_zero_denominator`, `zero_debt_service_breach` | l. 223 | No debt service ⇒ DSCR 0 ⇒ breach of any positive `>=` DSCR covenant. |
| `ExtRat`, `debtToNetWorth`, `extCompliantLe` | l. 224 | `equity > 0 ? totalDebt / equity : Infinity`, and how a `<=` test sees `Infinity`. |
| `dtnw_nonpos_equity`, `dtnw_zero_debt_zero_equity_breaches`, `dtnw_pos_equity` | l. 224 | Equity ≤ 0 ⇒ `Infinity` ⇒ breach of every finite `<=` threshold — even with zero debt. |

Helper lemmas over `Rat` (`abs_pos_of_ne`, `inv_nonneg_of_pos`,
`mul_nonneg_iff_of_pos`, `div_nonneg_iff_of_abs`, `sub_nonneg_iff`, …)
have no source counterpart; they support the headroom proofs.

### Close workflow — `src/close/workflow.ts`

| Lean | Source | What it says |
|---|---|---|
| `GateStatus` | `src/close/types.ts` l. 26 | The four gate statuses. |
| `signoffStatus` | ll. 232–262 | The sign-off gate (covenant block, then prior-gate block, then signature). Branch order in the model differs from the code but the truth table is identical. |
| `signoffStatus_complete_iff`, `signoffStatus_complete_prior` | ll. 232–262 | Sign-off is `complete` ⟺ all prior gates complete ∧ no covenant block ∧ signed. |
| `signoffReady` | ll. 354–357 | The report-level `signoff_ready` flag. |
| `signoffReady_prior_complete` | ll. 354–355 | `signoff_ready` ⇒ all prior gates complete. |
| `signoff_complete_ready` | ll. 354–357 | Sign-off complete ⇒ `signoff_ready`. |
| `signoff_ready_without_signature` | ll. 232–262 + 354–357 | `signoff_ready` can be `true` while the sign-off gate is only `in_progress` (no signature) — proved by `decide` on a concrete case. |
| `FreezeInput`, `freezeLate`, `freezeStatus`, `freezeStatus_invalid`, `freezeStatus_complete_iff` | ll. 60–93 (late test l. 79; absent vs invalid freeze ll. 61/71) | Freeze is `complete` ⟺ valid freeze timestamp ∧ ≥ 1 extract ∧ every extract parseable and ≤ freeze. |
| `cutoffStatus`, `cutoffStatus_complete_iff` | ll. 95–136 | Cutoffs `complete` ⟺ input supplied ∧ every required (system, subledger) pair frozen. |
| `recStatus`, `recStatus_complete_defaults` | ll. 138–165 (test l. 146) | Under default `require_recs_cleared`, complete ⇒ zero open items and coverage met. `covOk` abstracts the float coverage test. |
| `evidenceStatus`, `evidenceStatus_complete` | ll. 167–188 | Evidence `complete` ⇒ bundle nonempty ∧ all required kinds present. |
| `slaStatus`, `slaStatus_complete` | ll. 190–230 (past-SLA test l. 207) | SLA `complete` ⇒ supplied ∧ `now` parsed ∧ zero open exceptions. |
| `gateList`, `no_close_with_incomplete_prereqs` | ll. 344–350 | **Ordering**: if the assembled list's sign-off gate is `complete`, all five prior gates are `complete`. No closing a period with prerequisites incomplete. |

## Discrepancies and risks

### Covenant engine

1. **Missing metric silently passes `<=` covenants (fail-open).**
   `metrics[cov.metric] ?? 0.0` (l. 237): if a covenant names a metric
   that `computeMetrics` doesn't produce (config typo, renamed
   metric), the covenant is evaluated against `0`. For `<=` with a
   nonnegative threshold — e.g. the default *Debt to Tangible Net
   Worth ≤ 3.0* — that reports COMPLIANT with no data at all
   (`missing_metric_le_passes`). The `>=` direction fails closed
   instead. There is no "metric unknown" status anywhere in
   `CovenantResult`.

2. **Unknown operator strings silently mean `<=`.** `operator` is
   typed `">=" | "<="` but the runtime test is `op === ">=" ? … : …`
   (l. 240), so a config value like `">"` or `"≥"` (plausible from a
   hand-edited YAML/JSON config) is evaluated as `<=`, inverting the
   covenant's meaning (`opOf_ne_ge`).

3. **Zero threshold ⇒ headroom always reported as 0**, including on
   BREACH rows (l. 241, `threshold ? … : 0.0`): the signed certificate
   shows `0%` headroom for a breached covenant
   (`headroom_zero_threshold_breach_example`). Same effect for a
   non-numeric threshold: `Number(cov.threshold)` (l. 238) yields
   `NaN`, which is falsy (headroom 0) and makes every comparison
   false (BREACH) — JS semantics, outside the `Rat` model.

4. **Zero denominators report the metric as 0, not ∞/n-a.**
   Current ratio is `0` when current liabilities are `0` (l. 222), so
   a borrower with *no* current liabilities breaches the default
   *Current Ratio ≥ 1.0*; DSCR is `0` when `annual_debt_service` is
   unset/0 (l. 223), breaching *DSCR ≥ 1.25* regardless of EBITDA.
   Both fail closed, but the certificate states a metric value that
   is not the real ratio.

5. **`debt_to_net_worth` is `Infinity` whenever equity ≤ 0** (l. 224),
   so it breaches every finite `<=` threshold — including a borrower
   with **zero debt and zero equity** (`Infinity`, not `0`). Note the
   equity input is matched equity accounts *plus net income*
   (l. 216), so a loss-making period can push the metric to
   `Infinity` even with positive book equity accounts.

6. **Float vs rational divergence.** All comparisons and the headroom
   division run in IEEE-754 doubles in the code; the proofs are about
   exact rationals. A metric computed by division (DSCR, current
   ratio) can land on the "wrong" side of a threshold purely from
   rounding when the true value is within float error of the
   threshold (e.g. a true DSCR of exactly 1.25). The golden vectors
   (`spec/golden-vectors/covenant.json`) don't exercise such a
   boundary.

7. **Substring account matching.** `matchSum` (ll. 189–197) counts an
   account toward a metric if its lowercased name *contains* any
   pattern; the default `account_map` overlaps deliberately (cash
   patterns ⊂ current-asset patterns). A misleadingly named account
   (e.g. "Cash clearing — loans payable") can feed the wrong metric.
   Not modelled; noted because metric *inputs* are where the
   soundness theorems stop applying.

8. Parser defaults (not modelled): `toFloat` coerces unparseable
   Xero cells to `0.0` (ll. 94–99), so malformed trial-balance data
   degrades silently into the metrics.

### Close workflow

9. **Docs overstate the SLA gate.** `docs/five-day-close.md` lists
   the SLA gate's "Complete when" as *"No open exception with
   `now > opened_at + sla_hours`"*. The code (ll. 200–210) completes
   the gate only when there are **no open exceptions at all**; open
   exceptions inside SLA leave it `in_progress`. The doc describes
   the not-*blocked* condition, not `complete`.

10. **The 120-hour window gates nothing.** Both the docs and the
    OpenSpec spec describe the six gates as evaluated "in a
    configurable close window (default 120 hours)".
    `target_close_hours` is consulted only by the readiness metrics
    (`within_target`); every gate can be `complete` long after the
    window with no gate-level signal.

11. **`signoff_ready` does not mean signed.** It is true as soon as
    the prior gates are complete and the sign-off gate is not
    blocked — including while the gate is `in_progress` awaiting a
    signature (`signoff_ready_without_signature`). Any consumer
    reading `signoff_ready` as "the period is signed off" is wrong;
    only the gate status `complete` implies a signature
    (`signoffStatus_complete_iff`).

12. **The evidence gate can be satisfied entirely by generated
    artifacts.** `assembleEvidence` (ll. 264–320) always synthesizes
    the `exception_queue` artifact, synthesizes `extract` artifacts
    from the sources, and synthesizes `reconciliation` when recs
    exist — exactly the default required kinds. The gate therefore
    completes with zero caller-supplied evidence whenever sources
    and reconciliations are present. (The docs table does disclose
    "generated from the payload if omitted".)

13. **Cutoff gate completes vacuously for zero required pairs.** If
    `required_systems` resolves to none and there are no source
    systems, but some cutoff rows (or an empty
    `required_subledgers`) are supplied, missing/unfrozen are both
    empty and the gate reports `complete` — "Required subledgers
    frozen for 0 system(s)" (`cutoffStatus_complete_iff`, vacuous
    right-hand side).

14. **An open exception with an unparseable `opened_at` can never go
    past SLA.** The past-SLA test guards on `opened !== null`
    (l. 207), so such an exception keeps the SLA gate `in_progress`
    forever — never `blocked`, never `complete`. `opened_at` defaults
    to `freeze_at`, so a missing/unparseable freeze timestamp feeds
    the same hole.

15. **Reconciliation coverage is a float comparison** (l. 146):
    `covered / total >= min_reconciliation_coverage`. Exact at the
    default threshold 1, but a configured threshold like 0.95 is
    subject to binary rounding at the boundary. Also, an item whose
    status is none of `open`/`explained`/`cleared` (runtime data can
    violate the TS type) counts in the denominator but as neither
    covered nor open, so it cannot block via the open-items path —
    only via coverage.

16. **Covenant blocking is vacuous without covenants.**
    `covenantFlash` runs the engine whenever a trial balance is
    supplied, and `all_compliant` is `results.every(…)` (l. 332) —
    vacuously `true` for a config with an empty `covenants` list, so
    such a config can never block sign-off. Conversely, with no trial
    balance there is no covenant check at all (by design).

### Positive results (no discrepancy)

- Breach soundness and headroom-sign correctness hold exactly as a
  reader would expect, for both operator directions
  (`breach_ge_sound`, `breach_le_sound`, `headroom_sign_iff`).
- The sign-off ordering property the docs promise ("Prior gates
  complete and `signed_at` set", docs table Day 5) is exactly what
  the code enforces (`signoffStatus_complete_iff`,
  `no_close_with_incomplete_prereqs`).
- The freeze gate is *stricter* than its doc row: freeze set with
  zero extracts is `blocked`, and unparseable extract timestamps
  count as late (l. 79) — fail-closed in both cases.
