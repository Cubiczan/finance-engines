/**
 * Close-readiness helper: inventory ERP extracts, detect stale inputs,
 * report reconciliation coverage, and measure hours-to-close.
 *
 * Clock is injectable (`input.now`). Hours and stale flags are therefore
 * reproducible from fixtures.
 */

import type { ApInvoiceRow } from "../audit/exceptions.js";
import {
  doubleHandlingMinutes,
  straightThroughRate,
} from "../audit/exceptions.js";
import { hoursBetween, parseIsoDateTime, roundTo } from "../internal/dates.js";
import type {
  CloseConfig,
  CloseException,
  CloseGateResult,
  CloseMetrics,
  CloseReadinessReport,
  CloseWorkflowInput,
  ReconciliationCoverage,
  ReconciliationItem,
  SourceInventoryRow,
} from "./types.js";
import { DEFAULT_CLOSE_CONFIG } from "./types.js";

export function resolveCloseConfig(cfg: CloseConfig = {}): Required<
  Pick<
    CloseConfig,
    | "stale_after_hours"
    | "target_close_hours"
    | "exception_sla_hours"
    | "required_subledgers"
    | "required_evidence_kinds"
    | "min_reconciliation_coverage"
    | "require_recs_cleared"
    | "block_signoff_on_covenant_breach"
  >
> &
  CloseConfig {
  return {
    ...DEFAULT_CLOSE_CONFIG,
    ...cfg,
    required_subledgers:
      cfg.required_subledgers ?? DEFAULT_CLOSE_CONFIG.required_subledgers,
    required_evidence_kinds:
      cfg.required_evidence_kinds ?? DEFAULT_CLOSE_CONFIG.required_evidence_kinds,
  };
}

export function inventorySources(
  input: CloseWorkflowInput,
  cfg = resolveCloseConfig(input.config),
): SourceInventoryRow[] {
  const nowMs = parseIsoDateTime(input.now);
  const required = new Set(cfg.required_systems ?? []);
  const seen = new Set<string>();
  const rows: SourceInventoryRow[] = input.sources.map((src) => {
    seen.add(src.system_id);
    const extracted = parseIsoDateTime(src.extracted_at);
    const age =
      nowMs !== null && extracted !== null ? hoursBetween(extracted, nowMs) : null;
    const limit = src.stale_after_hours ?? cfg.stale_after_hours;
    return {
      system_id: src.system_id,
      erp: src.erp,
      legal_entity: src.legal_entity,
      extract_id: src.extract_id,
      extracted_at: src.extracted_at,
      as_of: src.as_of,
      age_hours: age === null ? null : roundTo(age, 2),
      stale: age !== null && age > limit,
      missing: false,
    };
  });
  for (const systemId of required) {
    if (!seen.has(systemId)) {
      rows.push({
        system_id: systemId,
        erp: "",
        legal_entity: "",
        extract_id: "",
        extracted_at: "",
        as_of: "",
        age_hours: null,
        stale: true,
        missing: true,
      });
    }
  }
  return rows;
}

export function reconciliationCoverage(
  items: ReconciliationItem[] = [],
): ReconciliationCoverage {
  const total = items.length;
  const covered = items.filter(
    (r) => r.status === "cleared" || r.status === "explained",
  ).length;
  const open = items.filter((r) => r.status === "open");
  return {
    total,
    covered,
    open_count: open.length,
    coverage: total === 0 ? 0 : covered / total,
    open_difference: open.reduce((a, r) => a + Math.abs(r.difference), 0),
  };
}

export function hoursToClose(input: CloseWorkflowInput): number | null {
  const end = parseIsoDateTime(input.signoff?.signed_at ?? input.now);
  const freeze = parseIsoDateTime(input.freeze_at);
  const earliestExtract = input.sources
    .map((s) => parseIsoDateTime(s.extracted_at))
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b)[0];
  const start = freeze ?? earliestExtract ?? null;
  if (start === null || end === null) return null;
  return roundTo(hoursBetween(start, end), 2);
}

export function computeCloseMetrics(
  input: CloseWorkflowInput,
  exceptions: CloseException[],
  systems?: SourceInventoryRow[],
  recs?: ReconciliationCoverage,
): CloseMetrics {
  const cfg = resolveCloseConfig(input.config);
  const invoices: ApInvoiceRow[] = input.invoices ?? [];
  const inv = systems ?? inventorySources(input, cfg);
  const rec = recs ?? reconciliationCoverage(input.reconciliations);
  const stale = inv.filter((s) => s.stale || s.missing);
  const stp = straightThroughRate({ invoices, exceptions });
  const flagged = new Set(exceptions.map((e) => String(e.invoice_id)));
  const hours = hoursToClose(input);
  const target = input.period.target_close_hours ?? cfg.target_close_hours;
  return {
    straight_through_rate: roundTo(stp, 4),
    double_handling_minutes: doubleHandlingMinutes({
      exceptions,
      invoices,
      handling_minutes: cfg.handling_minutes,
      retouch_minutes: cfg.retouch_minutes,
    }),
    stale_input_rate: inv.length === 0 ? 0 : roundTo(stale.length / inv.length, 4),
    hours_to_close: hours,
    target_close_hours: target,
    within_target: hours === null ? null : hours <= target,
    invoices_total: invoices.length,
    invoices_straight_through: invoices.filter((i) => !flagged.has(String(i.id))).length,
    invoices_exception: flagged.size,
    reconciliation_coverage: roundTo(rec.coverage, 4),
  };
}

export function assessCloseReadiness(
  input: CloseWorkflowInput,
  extras?: { exceptions?: CloseException[]; gates?: CloseGateResult[] },
): CloseReadinessReport {
  const cfg = resolveCloseConfig(input.config);
  const systems = inventorySources(input, cfg);
  const rec = reconciliationCoverage(input.reconciliations);
  const exceptions = extras?.exceptions ?? input.exceptions ?? [];
  const metrics = computeCloseMetrics(input, exceptions, systems, rec);
  return {
    period: input.period.label,
    now: input.now,
    systems,
    stale_inputs: systems.filter((s) => s.stale || s.missing),
    missing_systems: systems.filter((s) => s.missing).map((s) => s.system_id),
    reconciliation: rec,
    hours_to_close: metrics.hours_to_close,
    target_close_hours: metrics.target_close_hours,
    metrics,
    gates: extras?.gates ?? [],
  };
}
