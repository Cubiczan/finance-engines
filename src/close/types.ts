/**
 * Types for the multi-ERP five-day close reference workflow.
 *
 * Timestamps are caller-supplied ISO strings. The engine does not read
 * the system clock when `now` is provided.
 */

import type { ApException, ApExceptionConfig, ApInvoiceRow } from "../audit/exceptions.js";
import type { ItemRow } from "../audit/rules.js";
import type { CovenantConfig, CovenantMetrics, CovenantResult, TrialBalance } from "../covenant/engine.js";

export const CLOSE_GATES = [
  "source_freeze",
  "subledger_cutoffs",
  "reconciliation_queue",
  "evidence_bundle",
  "exception_sla",
  "controller_signoff",
] as const;

export type CloseGateId = (typeof CLOSE_GATES)[number];

export type CloseGateStatus = "not_started" | "in_progress" | "blocked" | "complete";

export type SubledgerName =
  | "ap"
  | "ar"
  | "inventory"
  | "fixed_assets"
  | "payroll"
  | "cash"
  | string;

export type ReconciliationStatus = "open" | "explained" | "cleared";

export type EvidenceKind =
  | "extract"
  | "reconciliation"
  | "exception_queue"
  | "covenant_certificate"
  | "signoff"
  | string;

export interface ClosePeriod {
  /** Reporting label, e.g. "2026-06". */
  label: string;
  period_end: string;
  /** Target hours from freeze to sign-off (default 120 = five days). */
  target_close_hours?: number;
}

export interface ErpSource {
  system_id: string;
  erp: string;
  legal_entity: string;
  extract_id: string;
  extracted_at: string;
  as_of: string;
  checksum?: string;
  stale_after_hours?: number;
}

export interface SubledgerCutoff {
  system_id: string;
  subledger: SubledgerName;
  cutoff_at: string;
  frozen: boolean;
}

export interface ReconciliationItem {
  id: string;
  source_a: string;
  source_b: string;
  account: string;
  difference: number;
  status: ReconciliationStatus;
  sla_hours?: number;
  opened_at?: string;
  resolved_at?: string;
}

export interface EvidenceArtifact {
  id: string;
  kind: EvidenceKind;
  source: string;
  checksum?: string;
  produced_at: string;
  generated?: boolean;
}

export interface ControllerSignoff {
  controller: string;
  signed_at?: string;
  notes?: string;
}

export type CloseExceptionStatus = "open" | "waived" | "resolved";

export interface CloseException extends ApException {
  status?: CloseExceptionStatus;
  opened_at?: string;
  sla_hours?: number;
}

export interface CloseConfig extends ApExceptionConfig {
  stale_after_hours?: number;
  target_close_hours?: number;
  exception_sla_hours?: number;
  required_systems?: string[];
  required_subledgers?: string[];
  required_evidence_kinds?: string[];
  min_reconciliation_coverage?: number;
  /** When true (default), open rec items block the reconciliation gate. */
  require_recs_cleared?: boolean;
  block_signoff_on_covenant_breach?: boolean;
}

export interface CloseWorkflowInput {
  period: ClosePeriod;
  /** Injectable clock. Required for deterministic hours / staleness / SLA. */
  now: string;
  freeze_at?: string;
  sources: ErpSource[];
  cutoffs?: SubledgerCutoff[];
  reconciliations?: ReconciliationItem[];
  evidence?: EvidenceArtifact[];
  invoices?: ApInvoiceRow[];
  items?: ItemRow[];
  exceptions?: CloseException[];
  signoff?: ControllerSignoff;
  trial_balance?: TrialBalance;
  covenant_config?: CovenantConfig;
  covenant_period?: string;
  config?: CloseConfig;
}

export interface SourceInventoryRow {
  system_id: string;
  erp: string;
  legal_entity: string;
  extract_id: string;
  extracted_at: string;
  as_of: string;
  age_hours: number | null;
  stale: boolean;
  missing: boolean;
}

export interface ReconciliationCoverage {
  total: number;
  covered: number;
  open_count: number;
  coverage: number;
  open_difference: number;
}

export interface CloseGateResult {
  id: CloseGateId;
  day: number;
  label: string;
  status: CloseGateStatus;
  detail: string;
}

export interface CloseMetrics {
  straight_through_rate: number;
  double_handling_minutes: number;
  stale_input_rate: number;
  hours_to_close: number | null;
  target_close_hours: number;
  within_target: boolean | null;
  invoices_total: number;
  invoices_straight_through: number;
  invoices_exception: number;
  reconciliation_coverage: number;
}

export interface CloseReadinessReport {
  period: string;
  now: string;
  systems: SourceInventoryRow[];
  stale_inputs: SourceInventoryRow[];
  missing_systems: string[];
  reconciliation: ReconciliationCoverage;
  hours_to_close: number | null;
  target_close_hours: number;
  metrics: CloseMetrics;
  gates: CloseGateResult[];
}

export interface CovenantFlash {
  metrics: CovenantMetrics;
  results: CovenantResult[];
  certificate: string;
  all_compliant: boolean;
}

export interface CloseWorkflowReport {
  period: string;
  now: string;
  gates: CloseGateResult[];
  readiness: CloseReadinessReport;
  exceptions: CloseException[];
  metrics: CloseMetrics;
  evidence: EvidenceArtifact[];
  covenant?: CovenantFlash;
  signoff_ready: boolean;
}

export const DEFAULT_CLOSE_CONFIG = {
  stale_after_hours: 36,
  target_close_hours: 120,
  exception_sla_hours: 48,
  required_subledgers: ["ap", "ar", "inventory", "cash"] as string[],
  required_evidence_kinds: ["extract", "reconciliation", "exception_queue"] as string[],
  min_reconciliation_coverage: 1,
  require_recs_cleared: true,
  block_signoff_on_covenant_breach: true,
};

export const GATE_DAYS: Record<CloseGateId, { day: number; label: string }> = {
  source_freeze: { day: 1, label: "Source freeze" },
  subledger_cutoffs: { day: 1, label: "Subledger cutoffs" },
  reconciliation_queue: { day: 2, label: "Reconciliation queue" },
  evidence_bundle: { day: 3, label: "Evidence bundle" },
  exception_sla: { day: 4, label: "Exception SLA" },
  controller_signoff: { day: 5, label: "Controller sign-off" },
};
