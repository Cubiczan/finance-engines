/**
 * AP exception taxonomy for procure-to-pay review.
 *
 * Extends the existing invoice-audit rules rather than replacing them:
 * duplicate detection reuses `duplicateNumbers` / `normalizeInvoiceNumber`,
 * and inconsistent tax can be mapped into `tax_review`. New checks cover
 * the exception types that kill straight-through rate — missing/mismatched
 * PO, missing receipt, wrong legal entity, tax review, ownerless approval.
 *
 * Pure and offline. Confidence and reason codes are deterministic tables,
 * not model scores. Handling minutes are synthetic defaults for close
 * metrics; they are not measured cycle times.
 */

import { HOUR_MS, parseIsoDateTime, roundTo } from "../internal/dates.js";
import type { AuditConfig, Finding, InvoiceRow, ItemRow, Severity } from "./rules.js";
import { duplicateNumbers, inconsistentTax, runAllAuditRules } from "./rules.js";

export const AP_EXCEPTION_CODES = [
  "duplicate_invoice",
  "missing_po",
  "mismatched_po",
  "missing_receipt",
  "wrong_legal_entity",
  "tax_review",
  "ownerless_approval",
] as const;

export type ApExceptionCode = (typeof AP_EXCEPTION_CODES)[number];

export const AP_REASON_CODES = {
  "DUP-NORM-COLLISION":
    "Invoice numbers normalize to the same vendor + number key",
  "PO-ABSENT": "PO is required but no PO number is present",
  "PO-NUMBER-MISMATCH": "Invoice PO number does not match the expected PO",
  "PO-AMOUNT-MISMATCH": "Invoice amount differs from PO amount beyond tolerance",
  "RCV-ABSENT": "Receipt is required but no receipt id is present",
  "RCV-QTY-SHORT": "Billed quantity exceeds received quantity",
  "LE-MISMATCH": "Invoice legal entity differs from the expected entity",
  "TAX-CODE-MISMATCH": "Invoice tax code differs from the expected tax code",
  "TAX-FLAG-REVIEW": "Invoice is explicitly flagged for tax review",
  "TAX-INCONSISTENT":
    "Same item is taxed on some invoices and not others for this supplier",
  "APPR-NO-OWNER": "Approval is required but no owner is assigned",
} as const;

export type ApReasonCode = keyof typeof AP_REASON_CODES;

/** Synthetic first-pass minutes per exception code (illustrative, not measured). */
export const DEFAULT_HANDLING_MINUTES: Record<ApExceptionCode, number> = {
  duplicate_invoice: 15,
  missing_po: 25,
  mismatched_po: 30,
  missing_receipt: 20,
  wrong_legal_entity: 40,
  tax_review: 35,
  ownerless_approval: 20,
};

/** Extra minutes when the same invoice is touched again (illustrative). */
export const DEFAULT_RETOUCH_MINUTES = 12;

export interface ApExceptionConfig extends AuditConfig {
  /** Percent of PO amount allowed before PO-AMOUNT-MISMATCH (default 1). */
  po_amount_tolerance_pct?: number;
  /** Reuse duplicateNumbers (default true). */
  include_duplicates?: boolean;
  /** Map inconsistentTax findings to tax_review (default true). */
  include_audit_tax?: boolean;
  handling_minutes?: Partial<Record<ApExceptionCode, number>>;
  retouch_minutes?: number;
}

interface ResolvedApConfig {
  po_amount_tolerance_pct: number;
  include_duplicates: boolean;
  include_audit_tax: boolean;
  handling_minutes: Record<ApExceptionCode, number>;
  retouch_minutes: number;
  audit: AuditConfig;
}

function resolveAp(cfg: ApExceptionConfig = {}): ResolvedApConfig {
  const {
    po_amount_tolerance_pct,
    include_duplicates,
    include_audit_tax,
    handling_minutes,
    retouch_minutes,
    ...audit
  } = cfg;
  return {
    po_amount_tolerance_pct: po_amount_tolerance_pct ?? 1,
    include_duplicates: include_duplicates ?? true,
    include_audit_tax: include_audit_tax ?? true,
    handling_minutes: { ...DEFAULT_HANDLING_MINUTES, ...handling_minutes },
    retouch_minutes: retouch_minutes ?? DEFAULT_RETOUCH_MINUTES,
    audit,
  };
}

/**
 * Invoice row plus optional 2-/3-way match context. All match fields are
 * optional so existing InvoiceRow fixtures keep working.
 */
export interface ApInvoiceRow extends InvoiceRow {
  po_number?: string | null;
  expected_po_number?: string | null;
  po_amount?: number | null;
  requires_po?: boolean | null;
  receipt_id?: string | null;
  receipt_required?: boolean | null;
  received_qty?: number | null;
  billed_qty?: number | null;
  legal_entity?: string | null;
  expected_legal_entity?: string | null;
  tax_code?: string | null;
  expected_tax_code?: string | null;
  tax_review_required?: boolean | null;
  approval_owner?: string | null;
  requires_approval?: boolean | null;
  source_system?: string | null;
  /** Prior human touches on this invoice; drives synthetic double-handling. */
  handling_touches?: number | null;
}

export interface ApException {
  invoice_id: number | string;
  invoice_number: string;
  supplier_name: string;
  source_system?: string;
  code: ApExceptionCode;
  reason_code: ApReasonCode;
  confidence: number;
  severity: Severity;
  detail: string;
  amount: number;
  /** Existing audit rule that produced this exception, when reused. */
  audit_rule?: string;
}

export interface TaxonomyEntry {
  code: ApExceptionCode;
  description: string;
  reason_codes: Array<{ code: ApReasonCode; description: string }>;
  handling_minutes: number;
}

export interface InvoiceReview {
  findings: Finding[];
  exceptions: ApException[];
}

const CODE_DESCRIPTIONS: Record<ApExceptionCode, string> = {
  duplicate_invoice:
    "Same vendor billed more than once under numbers that normalize together",
  missing_po: "Invoice requires a purchase order and none is present",
  mismatched_po: "Invoice PO number or amount does not match the expected PO",
  missing_receipt: "Three-way match cannot complete: receipt missing or short",
  wrong_legal_entity: "Invoice is booked to a different legal entity than expected",
  tax_review: "Tax code, flag, or historical tax treatment needs review",
  ownerless_approval: "Approval is required but the queue has no owner",
};

const REASONS_BY_CODE: Record<ApExceptionCode, ApReasonCode[]> = {
  duplicate_invoice: ["DUP-NORM-COLLISION"],
  missing_po: ["PO-ABSENT"],
  mismatched_po: ["PO-NUMBER-MISMATCH", "PO-AMOUNT-MISMATCH"],
  missing_receipt: ["RCV-ABSENT", "RCV-QTY-SHORT"],
  wrong_legal_entity: ["LE-MISMATCH"],
  tax_review: ["TAX-CODE-MISMATCH", "TAX-FLAG-REVIEW", "TAX-INCONSISTENT"],
  ownerless_approval: ["APPR-NO-OWNER"],
};

/** Published catalog for docs, MCP, and tests. */
export function apExceptionTaxonomy(): TaxonomyEntry[] {
  return AP_EXCEPTION_CODES.map((code) => ({
    code,
    description: CODE_DESCRIPTIONS[code],
    reason_codes: REASONS_BY_CODE[code].map((rc) => ({
      code: rc,
      description: AP_REASON_CODES[rc],
    })),
    handling_minutes: DEFAULT_HANDLING_MINUTES[code],
  }));
}

function present(v: string | null | undefined): boolean {
  return Boolean(v && String(v).trim());
}

function normToken(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sameToken(a: string, b: string): boolean {
  return normToken(a) === normToken(b);
}

function findingInvoiceIds(finding: Finding, invoices: InvoiceRow[]): InvoiceRow[] {
  const nums = new Set(
    finding.invoice_number.split(",").map((s) => s.trim()).filter(Boolean),
  );
  return invoices.filter(
    (inv) =>
      nums.has(inv.invoice_number) && inv.supplier_name === finding.supplier_name,
  );
}

function duplicateConfidence(group: InvoiceRow[]): number {
  const raws = new Set(group.map((g) => g.invoice_number));
  return raws.size === 1 ? 0.99 : 0.9;
}

function fromFinding(
  inv: ApInvoiceRow,
  code: ApExceptionCode,
  reason_code: ApReasonCode,
  finding: Finding,
  confidence: number,
): ApException {
  return {
    invoice_id: inv.id,
    invoice_number: inv.invoice_number,
    supplier_name: inv.supplier_name,
    ...(inv.source_system ? { source_system: inv.source_system } : {}),
    code,
    reason_code,
    confidence,
    severity: finding.severity,
    detail: finding.detail,
    amount: inv.sum,
    audit_rule: finding.rule,
  };
}

function exception(
  inv: ApInvoiceRow,
  code: ApExceptionCode,
  reason_code: ApReasonCode,
  confidence: number,
  severity: Severity,
  detail: string,
): ApException {
  return {
    invoice_id: inv.id,
    invoice_number: inv.invoice_number,
    supplier_name: inv.supplier_name,
    ...(inv.source_system ? { source_system: inv.source_system } : {}),
    code,
    reason_code,
    confidence: roundTo(confidence, 2),
    severity,
    detail,
    amount: inv.sum,
  };
}

/**
 * Classify AP exceptions over invoice rows. Duplicate and inconsistent-tax
 * findings are reused from the audit engine; remaining codes use match
 * context on `ApInvoiceRow`.
 */
export function classifyApExceptions(
  invoices: ApInvoiceRow[],
  items: ItemRow[] = [],
  cfg: ApExceptionConfig = {},
): ApException[] {
  const resolved = resolveAp(cfg);
  const out: ApException[] = [];

  if (resolved.include_duplicates) {
    for (const finding of duplicateNumbers(invoices)) {
      const group = findingInvoiceIds(finding, invoices);
      const conf = duplicateConfidence(group.length ? group : invoices);
      const members = group.length ? group : invoices.filter((i) => i.supplier_name === finding.supplier_name);
      for (const inv of members) {
        out.push(
          fromFinding(inv, "duplicate_invoice", "DUP-NORM-COLLISION", finding, conf),
        );
      }
    }
  }

  if (resolved.include_audit_tax) {
    for (const finding of inconsistentTax(invoices, items)) {
      const members = invoices.filter(
        (inv) =>
          inv.invoice_number === finding.invoice_number &&
          inv.supplier_name === finding.supplier_name,
      );
      for (const inv of members) {
        out.push(
          fromFinding(inv, "tax_review", "TAX-INCONSISTENT", finding, 0.88),
        );
      }
    }
  }

  for (const inv of invoices) {
    const requiresPo = inv.requires_po === true || present(inv.expected_po_number ?? undefined);
    if (requiresPo && !present(inv.po_number ?? undefined)) {
      out.push(
        exception(
          inv,
          "missing_po",
          "PO-ABSENT",
          0.99,
          "high",
          "PO required but no PO number is present on the invoice",
        ),
      );
    } else if (present(inv.po_number ?? undefined) && present(inv.expected_po_number ?? undefined)) {
      if (!sameToken(inv.po_number as string, inv.expected_po_number as string)) {
        out.push(
          exception(
            inv,
            "mismatched_po",
            "PO-NUMBER-MISMATCH",
            0.95,
            "high",
            `PO '${inv.po_number}' does not match expected '${inv.expected_po_number}'`,
          ),
        );
      }
    }

    if (
      inv.po_amount != null &&
      Number.isFinite(inv.po_amount) &&
      Math.abs(inv.po_amount) > 0 &&
      (requiresPo || present(inv.po_number ?? undefined))
    ) {
      const pct = (Math.abs(inv.sum - inv.po_amount) / Math.abs(inv.po_amount)) * 100;
      if (pct > resolved.po_amount_tolerance_pct) {
        out.push(
          exception(
            inv,
            "mismatched_po",
            "PO-AMOUNT-MISMATCH",
            Math.min(0.99, 0.7 + pct / 200),
            pct >= 10 ? "high" : "med",
            `Invoice ${inv.sum} differs from PO amount ${inv.po_amount} by ${roundTo(pct, 1)}%`,
          ),
        );
      }
    }

    if (inv.receipt_required === true && !present(inv.receipt_id ?? undefined)) {
      out.push(
        exception(
          inv,
          "missing_receipt",
          "RCV-ABSENT",
          0.93,
          "high",
          "Receipt required for match but no receipt id is present",
        ),
      );
    } else if (
      inv.received_qty != null &&
      inv.billed_qty != null &&
      inv.billed_qty > inv.received_qty
    ) {
      out.push(
        exception(
          inv,
          "missing_receipt",
          "RCV-QTY-SHORT",
          0.86,
          "med",
          `Billed qty ${inv.billed_qty} exceeds received qty ${inv.received_qty}`,
        ),
      );
    }

    if (present(inv.legal_entity ?? undefined) && present(inv.expected_legal_entity ?? undefined)) {
      if (!sameToken(inv.legal_entity as string, inv.expected_legal_entity as string)) {
        out.push(
          exception(
            inv,
            "wrong_legal_entity",
            "LE-MISMATCH",
            0.99,
            "high",
            `Booked to '${inv.legal_entity}' but expected '${inv.expected_legal_entity}'`,
          ),
        );
      }
    }

    if (inv.tax_review_required === true) {
      out.push(
        exception(
          inv,
          "tax_review",
          "TAX-FLAG-REVIEW",
          1,
          "med",
          "Invoice is flagged for tax review",
        ),
      );
    }
    if (present(inv.tax_code ?? undefined) && present(inv.expected_tax_code ?? undefined)) {
      if (!sameToken(inv.tax_code as string, inv.expected_tax_code as string)) {
        out.push(
          exception(
            inv,
            "tax_review",
            "TAX-CODE-MISMATCH",
            0.92,
            "med",
            `Tax code '${inv.tax_code}' does not match expected '${inv.expected_tax_code}'`,
          ),
        );
      }
    }

    if (inv.requires_approval === true && !present(inv.approval_owner ?? undefined)) {
      out.push(
        exception(
          inv,
          "ownerless_approval",
          "APPR-NO-OWNER",
          0.97,
          "high",
          "Approval required but no owner is assigned",
        ),
      );
    }
  }

  return out;
}

/** Run classic audit findings and AP exceptions in one call. */
export function runInvoiceReview(
  invoices: ApInvoiceRow[],
  items: ItemRow[] = [],
  cfg: ApExceptionConfig = {},
): InvoiceReview {
  return {
    findings: runAllAuditRules(invoices, items, cfg),
    exceptions: classifyApExceptions(invoices, items, cfg),
  };
}

export interface DoubleHandlingInput {
  exceptions: ApException[];
  invoices?: ApInvoiceRow[];
  handling_minutes?: Partial<Record<ApExceptionCode, number>>;
  retouch_minutes?: number;
}

/**
 * Synthetic double-handling minutes: first exception on an invoice is
 * first-pass time; each additional exception on the same invoice plus each
 * extra `handling_touches` beyond 1 is double-handling.
 */
export function doubleHandlingMinutes(input: DoubleHandlingInput): number {
  const minutes = { ...DEFAULT_HANDLING_MINUTES, ...input.handling_minutes };
  const retouch = input.retouch_minutes ?? DEFAULT_RETOUCH_MINUTES;
  const byInvoice = new Map<string, ApException[]>();
  for (const ex of input.exceptions) {
    const key = `${ex.invoice_id}`;
    const list = byInvoice.get(key);
    if (list) list.push(ex);
    else byInvoice.set(key, [ex]);
  }
  const touches = new Map<string, number>();
  for (const inv of input.invoices ?? []) {
    touches.set(String(inv.id), inv.handling_touches ?? 1);
  }

  let total = 0;
  for (const [id, list] of byInvoice) {
    if (list.length > 1) {
      for (const extra of list.slice(1)) {
        total += minutes[extra.code];
      }
    }
    const nTouches = touches.get(id) ?? 1;
    if (nTouches > 1) {
      total += (nTouches - 1) * retouch;
    }
  }
  return total;
}

export interface StraightThroughInput {
  invoices: ApInvoiceRow[];
  exceptions: ApException[];
}

/** Exception-free invoices / total. Zero invoices → 1 (vacuous). */
export function straightThroughRate(input: StraightThroughInput): number {
  if (input.invoices.length === 0) return 1;
  const flagged = new Set(input.exceptions.map((e) => String(e.invoice_id)));
  const clean = input.invoices.filter((inv) => !flagged.has(String(inv.id))).length;
  return clean / input.invoices.length;
}

/** Hours from `opened_at` (or invoice create/issue date) to `now`. */
export function exceptionAgeHours(
  inv: ApInvoiceRow,
  now: string,
  openedAt?: string | null,
): number | null {
  const start = parseIsoDateTime(openedAt ?? inv.create_date ?? inv.issue_date);
  const end = parseIsoDateTime(now);
  if (start === null || end === null) return null;
  return (end - start) / HOUR_MS;
}
