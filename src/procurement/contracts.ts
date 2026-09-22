/**
 * Public boundary for procurement-to-profitability callers.
 *
 * This module contains types only. It does not implement AP exception or
 * close-workflow logic; callers own those workflows and invoke this package as
 * a dependency for the covenant and invoice-audit calculations.
 */

import type {
  CovenantConfig,
  CovenantMetrics,
  CovenantResult,
  TrialBalance,
} from "../covenant/engine.js";
import type {
  AuditConfig,
  Finding,
  InvoiceRow,
  ItemRow,
} from "../audit/rules.js";

export const PROCUREMENT_PROFITABILITY_CONTRACT_VERSION =
  "procurement-profitability.v1" as const;

export interface IntegrationProvenance {
  /** The package is invoked by the caller; no source-system access is implied. */
  invocation: "dependency";
  package: "@cubiczan/finance-engines";
  contract_version: typeof PROCUREMENT_PROFITABILITY_CONTRACT_VERSION;
  source_system?: string;
  source_reference?: string;
}

export interface CovenantCheckInput {
  trial_balance: TrialBalance;
  config: CovenantConfig;
  period: string;
  provenance: IntegrationProvenance;
}

export interface CovenantCheckOutput {
  metrics: CovenantMetrics;
  results: CovenantResult[];
  certificate_markdown: string;
  provenance: IntegrationProvenance;
}

export interface InvoiceAuditInput {
  invoices: InvoiceRow[];
  items?: ItemRow[];
  config?: AuditConfig;
  provenance: IntegrationProvenance;
}

export interface InvoiceAuditOutput {
  findings: Finding[];
  finding_count: number;
  provenance: IntegrationProvenance;
}

export type APExceptionKind =
  | "duplicate_invoice"
  | "missing_approval"
  | "price_variance"
  | "quantity_variance"
  | "tax_mismatch"
  | "payment_hold"
  | "other";

export type APExceptionStatus = "open" | "in_review" | "resolved" | "waived";

export interface APException {
  id: string;
  kind: APExceptionKind;
  status: APExceptionStatus;
  supplier_id?: string;
  invoice_id?: string;
  amount?: number;
  currency?: string;
  owner?: string;
  reason: string;
  evidence_refs?: string[];
}

export interface APExceptionsInput {
  as_of: string;
  exceptions: APException[];
  provenance: IntegrationProvenance;
}

export interface APExceptionsOutput {
  open_count: number;
  open_amount?: number;
  exceptions: APException[];
  provenance: IntegrationProvenance;
}

export type CloseDay = 1 | 2 | 3 | 4 | 5;
export type CloseTaskStatus = "not_started" | "in_progress" | "complete" | "blocked";

export interface FiveDayCloseTask {
  id: string;
  day: CloseDay;
  name: string;
  status: CloseTaskStatus;
  owner?: string;
  completed_at?: string;
  blocker?: string;
  evidence_refs?: string[];
}

export interface FiveDayCloseInput {
  period: string;
  tasks: FiveDayCloseTask[];
  provenance: IntegrationProvenance;
}

export interface FiveDayCloseOutput {
  period: string;
  ready: boolean;
  completed_tasks: number;
  total_tasks: number;
  blocked_tasks: string[];
  tasks: FiveDayCloseTask[];
  provenance: IntegrationProvenance;
}

/**
 * Optional caller adapter. Implementations may delegate the first two methods
 * to this package and keep AP/close persistence and workflow policy local.
 */
export interface ProcurementProfitabilityAdapter {
  checkCovenant(input: CovenantCheckInput): CovenantCheckOutput;
  auditInvoices(input: InvoiceAuditInput): InvoiceAuditOutput;
  reviewAPExceptions(input: APExceptionsInput): APExceptionsOutput;
  assessFiveDayClose(input: FiveDayCloseInput): FiveDayCloseOutput;
}
