/**
 * @cubiczan/finance-engines — deterministic finance engines for AI agents.
 *
 * Pure, offline engines usable directly as a library (this module) or
 * over MCP (bin: finance-engines-mcp):
 *   - margin:   commodity-linked product economics, price sensitivity,
 *               breakeven, and contract structure evaluation
 *   - covenant: trial-balance parsing, covenant metrics, evaluation, and
 *               compliance certificate rendering
 *   - audit:    vendor-invoice anomaly rules and invoice-number normalization
 *   - close:    five-day close readiness, AP exception taxonomy, operator metrics
 *
 * Copyright (c) 2026 Shyam Desigan (Cubiczan). All rights reserved.
 * Commercial license required — see LICENSE.md.
 */

// Margin engine
export type {
  AssayPayablesSpec,
  CollarSpec,
  ContractResult,
  ContractSpec,
  DiscountProfitShareSpec,
  GradeMultiplierSpec,
  MarginConfig,
  Prices,
  ProductEconomics,
  ProductSpec,
  SensitivityRow,
} from "./margin/types.js";
export {
  breakevenPrices,
  parsePricesCsv,
  productEconomics,
  sensitivity,
} from "./margin/engine.js";
export { evaluateAllContracts, evaluateContract } from "./margin/contracts.js";
export {
  defaultMarginConfig,
  SAMPLE_PRICES_CSV,
  samplePrices,
} from "./margin/defaults.js";

// Covenant engine
export type {
  CovenantConfig,
  CovenantMetrics,
  CovenantResult,
  CovenantSpec,
  TrialBalance,
  TrialBalanceRecord,
  TrialBalanceSection,
  XeroTrialBalanceReport,
} from "./covenant/engine.js";
export {
  allAccounts,
  certificateMarkdown,
  computeMetrics,
  evaluateCovenants,
  parseXeroTrialBalance,
  trialBalanceFromRecords,
} from "./covenant/engine.js";
export { defaultCovenantConfig } from "./covenant/defaults.js";

// Invoice audit engine
export type {
  AuditConfig,
  Finding,
  InvoiceRow,
  ItemRow,
  Severity,
} from "./audit/rules.js";
export {
  amountOutliers,
  DEFAULT_AUDIT_CONFIG,
  duplicateNumbers,
  entryLag,
  inconsistentTax,
  negativeAdjustments,
  newChargeTypes,
  normalizeInvoiceNumber,
  overdueUnpaid,
  rateChanges,
  runAllAuditRules,
} from "./audit/rules.js";

// AP exceptions (extends invoice audit)
export type {
  ApException,
  ApExceptionCode,
  ApExceptionConfig,
  ApInvoiceRow,
  ApReasonCode,
  DoubleHandlingInput,
  InvoiceReview,
  StraightThroughInput,
  TaxonomyEntry,
} from "./audit/exceptions.js";
export {
  AP_EXCEPTION_CODES,
  AP_REASON_CODES,
  DEFAULT_HANDLING_MINUTES,
  DEFAULT_RETOUCH_MINUTES,
  apExceptionTaxonomy,
  classifyApExceptions,
  doubleHandlingMinutes,
  exceptionAgeHours,
  runInvoiceReview,
  straightThroughRate,
} from "./audit/exceptions.js";

// Five-day close
export type {
  CloseConfig,
  CloseException,
  CloseExceptionStatus,
  CloseGateId,
  CloseGateResult,
  CloseGateStatus,
  CloseMetrics,
  ClosePeriod,
  CloseReadinessReport,
  CloseWorkflowInput,
  CloseWorkflowReport,
  ControllerSignoff,
  CovenantFlash,
  ErpSource,
  EvidenceArtifact,
  EvidenceKind,
  ReconciliationCoverage,
  ReconciliationItem,
  ReconciliationStatus,
  SourceInventoryRow,
  SubledgerCutoff,
  SubledgerName,
} from "./close/types.js";
export {
  CLOSE_GATES,
  DEFAULT_CLOSE_CONFIG,
  GATE_DAYS,
} from "./close/types.js";
export {
  assessCloseReadiness,
  computeCloseMetrics,
  hoursToClose,
  inventorySources,
  reconciliationCoverage,
  resolveCloseConfig,
} from "./close/readiness.js";
export {
  closeGateOrder,
  defaultCloseWindowHours,
  runFiveDayClose,
} from "./close/workflow.js";
