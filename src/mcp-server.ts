#!/usr/bin/env node
/**
 * MCP server for @cubiczan/finance-engines (stdio transport).
 *
 * Exposes the deterministic engines — commodity margins, loan covenants,
 * invoice audit, AP exceptions, and five-day close — as Model Context
 * Protocol tools. Thin wrapper: all numeric logic lives in the library
 * modules and is reused verbatim. Fully offline; when config/prices are
 * omitted the bundled defaults apply.
 *
 * Copyright (c) 2026 Shyam Desigan (Cubiczan). All rights reserved.
 * Commercial license required — see LICENSE.md.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { ApExceptionConfig, ApInvoiceRow } from "./audit/exceptions.js";
import {
  apExceptionTaxonomy,
  classifyApExceptions,
} from "./audit/exceptions.js";
import type { AuditConfig, InvoiceRow, ItemRow } from "./audit/rules.js";
import { normalizeInvoiceNumber, runAllAuditRules } from "./audit/rules.js";
import type { CloseWorkflowInput } from "./close/types.js";
import { assessCloseReadiness } from "./close/readiness.js";
import { runFiveDayClose } from "./close/workflow.js";
import { defaultCovenantConfig } from "./covenant/defaults.js";
import type {
  CovenantConfig,
  TrialBalance,
  XeroTrialBalanceReport,
} from "./covenant/engine.js";
import {
  certificateMarkdown,
  computeMetrics,
  evaluateCovenants,
  parseXeroTrialBalance,
} from "./covenant/engine.js";
import { evaluateAllContracts } from "./margin/contracts.js";
import { defaultMarginConfig, samplePrices } from "./margin/defaults.js";
import {
  breakevenPrices,
  productEconomics,
  sensitivity,
} from "./margin/engine.js";
import type { MarginConfig, Prices } from "./margin/types.js";

const server = new McpServer(
  { name: "@cubiczan/finance-engines", version: "0.1.0" },
  {
    instructions:
      "Deterministic, offline finance engines: index-linked commodity margins " +
      "and contract structures; loan covenant metrics, evaluation, and " +
      "compliance certificates; vendor-invoice anomaly detection; AP exception " +
      "taxonomy; and a five-day close readiness workflow. All tools are pure " +
      "functions over the supplied inputs — no network, no state. When " +
      "config/prices are omitted, bundled sample defaults apply. Licensed " +
      "commercial software (contact sam@cubiczan.com).",
  },
);

function jsonResult(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
    ],
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ---------------------------------------------------------------- margin ----

const marginConfigParam = z
  .record(z.any())
  .optional()
  .describe(
    "Margin config (products, indices, cost_per_mt, inventory_mt, " +
      "sensitivity_shocks, contracts). Defaults to the bundled sample config.",
  );
const pricesParam = z
  .record(z.number())
  .optional()
  .describe(
    "Index prices {symbol: usd_per_tonne}. Defaults to the bundled sample feed.",
  );

function resolveMargin(
  config: Record<string, unknown> | undefined,
  prices: Record<string, number> | undefined,
): { cfg: MarginConfig; px: Prices } {
  return {
    cfg: (config as unknown as MarginConfig) ?? defaultMarginConfig,
    px: prices ?? samplePrices(),
  };
}

server.registerTool(
  "product_margins",
  {
    title: "Product margins per tonne",
    description:
      "Compute per-product revenue, cost, and margin per metric tonne. " +
      "Revenue/MT = sum over metals of (assay% x payable% x index price), " +
      "marked to market against inventory. Returns one record per product " +
      "with metal contributions and inventory valuation.",
    inputSchema: { config: marginConfigParam, prices: pricesParam },
  },
  async ({ config, prices }) => {
    const { cfg, px } = resolveMargin(config, prices);
    return jsonResult(productEconomics(cfg, px));
  },
);

server.registerTool(
  "price_sensitivity",
  {
    title: "Price sensitivity grid",
    description:
      "Margin-per-tonne sensitivity for one product under price shocks: an " +
      "'all metals' row plus one row per metal, showing margin/MT under each " +
      "configured shock (default -25%/-10%/+10%/+25%).",
    inputSchema: {
      product: z.string().describe("Product name (must exist in config.products)."),
      config: marginConfigParam,
      prices: pricesParam,
    },
  },
  async ({ product, config, prices }) => {
    const { cfg, px } = resolveMargin(config, prices);
    return jsonResult(sensitivity(cfg, px, product));
  },
);

server.registerTool(
  "breakeven",
  {
    title: "Breakeven index prices",
    description:
      "Implied per-metal index prices at which a product's margin/MT hits " +
      "zero (uniform cost/revenue multiple applied to current prices).",
    inputSchema: {
      product: z.string().describe("Product name (must exist in config.products)."),
      config: marginConfigParam,
      prices: pricesParam,
    },
  },
  async ({ product, config, prices }) => {
    const { cfg, px } = resolveMargin(config, prices);
    return jsonResult(breakevenPrices(cfg, px, product));
  },
);

server.registerTool(
  "evaluate_contracts",
  {
    title: "Evaluate contract structures",
    description:
      "Evaluate all configured offtake/feedstock contract structures at spot. " +
      "Supports grade_multiplier, discount_profit_share, collar, and " +
      "assay_payables. Returns each contract's outputs and binding flags " +
      "(collar floor/ceiling binding, profit-share triggered).",
    inputSchema: { config: marginConfigParam, prices: pricesParam },
  },
  async ({ config, prices }) => {
    const { cfg, px } = resolveMargin(config, prices);
    return jsonResult(evaluateAllContracts(cfg, px));
  },
);

// -------------------------------------------------------------- covenant ----

const trialBalanceParam = z
  .record(z.record(z.number()))
  .describe(
    "Section balances (revenue/expenses/assets/liabilities/equity), each " +
      "mapping account name -> netted balance, as returned by parse_trial_balance.",
  );
const covenantConfigParam = z
  .record(z.any())
  .optional()
  .describe(
    "Covenant config (account_map, annual_debt_service, covenants). " +
      "Defaults to the bundled sample config.",
  );

const uipathHandoffParam = z
  .object({
    kind: z
      .enum([
        "audit_invoices",
        "compliance_certificate",
        "evaluate_contracts",
        "classify_ap_exceptions",
        "five_day_close",
      ])
      .describe("Which deterministic engine the UiPath handoff should trigger."),
    source: z.string().optional().describe("Optional source label from UiPath."),
    summary: z.string().optional().describe("Optional UiPath summary to echo back."),
    invoices: z
      .array(z.record(z.any()))
      .optional()
      .describe("Invoice rows for the audit engine."),
    items: z
      .array(z.record(z.any()))
      .optional()
      .describe("Optional line-item rows for the audit engine."),
    trial_balance: trialBalanceParam
      .optional()
      .describe("Trial balance sections for covenant evaluation."),
    period: z
      .string()
      .optional()
      .describe("Reporting period label for compliance certificates."),
    config: z
      .record(z.any())
      .optional()
      .describe("Optional engine config passed through from UiPath."),
    prices: pricesParam,
    entry_lag_days: z.number().int().optional(),
    overdue_days: z.number().int().optional(),
    amount_outlier_multiple: z.number().optional(),
    rate_change_pct: z.number().optional(),
    min_invoices_for_baseline: z.number().int().optional(),
    close: z
      .record(z.any())
      .optional()
      .describe("Five-day close payload (period, now, sources, …) for five_day_close."),
  })
  .describe("Thin UiPath handoff wrapper over the deterministic engines.");

function toTrialBalance(sections: Record<string, Record<string, number>>): TrialBalance {
  return {
    revenue: sections.revenue ?? {},
    expenses: sections.expenses ?? {},
    assets: sections.assets ?? {},
    liabilities: sections.liabilities ?? {},
    equity: sections.equity ?? {},
  };
}

function covenantCfg(config: Record<string, unknown> | undefined): CovenantConfig {
  return (config as unknown as CovenantConfig) ?? defaultCovenantConfig;
}

server.registerTool(
  "parse_trial_balance",
  {
    title: "Parse trial balance",
    description:
      "Flatten a Xero Reports/TrialBalance payload into netted section " +
      "balances (debit positive for assets/expenses, credit positive for " +
      "revenue/liabilities/equity). Returns a dict keyed by section, each " +
      "mapping account name -> balance.",
    inputSchema: {
      report: z
        .record(z.any())
        .describe("A parsed Xero Reports/TrialBalance JSON payload."),
    },
  },
  async ({ report }) =>
    jsonResult(parseXeroTrialBalance(report as XeroTrialBalanceReport)),
);

server.registerTool(
  "compute_covenant_metrics",
  {
    title: "Compute covenant metrics",
    description:
      "Compute financial metrics used by loan covenants from a trial " +
      "balance: revenue, net_income, ebitda, cash, current_ratio, dscr, " +
      "debt_to_net_worth, total_debt, equity.",
    inputSchema: { trial_balance: trialBalanceParam, config: covenantConfigParam },
  },
  async ({ trial_balance, config }) =>
    jsonResult(computeMetrics(toTrialBalance(trial_balance), covenantCfg(config))),
);

server.registerTool(
  "evaluate_covenants",
  {
    title: "Evaluate covenants",
    description:
      "Test computed metrics against covenant thresholds. Each result " +
      "reports the metric value, operator, threshold, compliant flag, and " +
      "percentage headroom to the threshold.",
    inputSchema: {
      metrics: z
        .record(z.number())
        .describe("Metric values, as from compute_covenant_metrics."),
      config: covenantConfigParam,
    },
  },
  async ({ metrics, config }) =>
    jsonResult(evaluateCovenants(metrics, covenantCfg(config))),
);

server.registerTool(
  "compliance_certificate",
  {
    title: "Compliance certificate",
    description:
      "Generate a full markdown covenant compliance certificate for a " +
      "period. End-to-end: computes metrics, evaluates covenants, and " +
      "renders the signable lender certificate in one call.",
    inputSchema: {
      trial_balance: trialBalanceParam,
      period: z.string().describe('Reporting period label, e.g. "Q2 2026".'),
      config: covenantConfigParam,
    },
  },
  async ({ trial_balance, period, config }) => {
    const cfg = covenantCfg(config);
    const tb = toTrialBalance(trial_balance);
    const metrics = computeMetrics(tb, cfg);
    const results = evaluateCovenants(metrics, cfg);
    return textResult(certificateMarkdown(results, metrics, period));
  },
);

// ----------------------------------------------------------------- audit ----

server.registerTool(
  "audit_invoices",
  {
    title: "Audit vendor invoices",
    description:
      "Run all anomaly rules over a set of invoices (and optional line " +
      "items): duplicate numbers, entry lag, overdue-unpaid, amount " +
      "outliers, unit-rate changes, new charge types, unexplained credits, " +
      "and inconsistent tax. Header-level rules always run; item-level rules " +
      "run only when line items are supplied.",
    inputSchema: {
      invoices: z
        .array(z.record(z.any()))
        .describe(
          "Invoice rows: id, invoice_number, supplier_id, supplier_name, " +
            "issue_date, create_date, required_date, sum, sum_paid, status.",
        ),
      items: z
        .array(z.record(z.any()))
        .optional()
        .describe(
          "Optional line-item rows: invoice_id, name, price, quantity, " +
            "line_sum, tax_percent.",
        ),
      entry_lag_days: z.number().int().optional()
        .describe("Days between issue and entry before flagging entry lag (default 14)."),
      overdue_days: z.number().int().optional()
        .describe("Days past due before flagging an approved-but-unpaid invoice (default 10)."),
      amount_outlier_multiple: z.number().optional()
        .describe("Multiple of a vendor's median to flag as an outlier (default 3.0)."),
      rate_change_pct: z.number().optional()
        .describe("Percent unit-price change to flag for a recurring item (default 5.0)."),
      min_invoices_for_baseline: z.number().int().optional()
        .describe("Minimum invoices per vendor before outlier logic runs (default 3)."),
      today: z.string().optional()
        .describe("ISO date used as 'today' for overdue checks (default: current date)."),
    },
  },
  async ({ invoices, items, ...cfg }) => {
    const config: AuditConfig = Object.fromEntries(
      Object.entries(cfg).filter(([, v]) => v !== undefined),
    );
    return jsonResult(
      runAllAuditRules(
        invoices as unknown as InvoiceRow[],
        (items ?? []) as unknown as ItemRow[],
        config,
      ),
    );
  },
);

server.registerTool(
  "normalize_invoice_number",
  {
    title: "Normalize invoice number",
    description:
      "Normalize an invoice number for duplicate detection: strips " +
      "punctuation, uppercases, and drops common prefixes so 'INV123', " +
      "'#INV123', and 'NV123' collide to the same canonical form.",
    inputSchema: {
      number: z.string().describe("A raw invoice number as printed by the vendor."),
    },
  },
  async ({ number }) => textResult(normalizeInvoiceNumber(number)),
);

const closePayloadParam = z
  .record(z.any())
  .describe(
    "Close payload: period {label, period_end}, now (ISO), freeze_at, " +
      "sources[], cutoffs[], reconciliations[], evidence[], invoices[], " +
      "optional items/exceptions/signoff/trial_balance/config.",
  );

server.registerTool(
  "classify_ap_exceptions",
  {
    title: "Classify AP exceptions",
    description:
      "Classify vendor invoices into the AP exception taxonomy: duplicate " +
      "invoice (reuses audit normalize/duplicate rules), missing/mismatched " +
      "PO, missing receipt, wrong legal entity, tax review, and ownerless " +
      "approval. Each exception includes confidence and a stable reason code. " +
      "Invoices without match-context fields are only eligible for duplicate " +
      "and inconsistent-tax reuse.",
    inputSchema: {
      invoices: z
        .array(z.record(z.any()))
        .describe("Invoice rows plus optional PO/receipt/entity/tax/approval fields."),
      items: z
        .array(z.record(z.any()))
        .optional()
        .describe("Optional line items (enables inconsistent-tax → tax_review)."),
      po_amount_tolerance_pct: z.number().optional(),
      include_duplicates: z.boolean().optional(),
      include_audit_tax: z.boolean().optional(),
      today: z.string().optional(),
    },
  },
  async ({ invoices, items, ...cfg }) => {
    const config: ApExceptionConfig = Object.fromEntries(
      Object.entries(cfg).filter(([, v]) => v !== undefined),
    );
    return jsonResult({
      taxonomy: apExceptionTaxonomy(),
      exceptions: classifyApExceptions(
        invoices as unknown as ApInvoiceRow[],
        (items ?? []) as unknown as ItemRow[],
        config,
      ),
    });
  },
);

server.registerTool(
  "close_readiness",
  {
    title: "Close readiness",
    description:
      "Inventory ERP extracts, flag stale inputs, report reconciliation " +
      "coverage, and compute hours-to-close from freeze (or earliest extract) " +
      "to sign-off or the supplied `now`. Does not mutate state. Pass " +
      "precomputed exceptions or invoices to include STP / double-handling.",
    inputSchema: { close: closePayloadParam },
  },
  async ({ close }) => jsonResult(assessCloseReadiness(close as unknown as CloseWorkflowInput)),
);

server.registerTool(
  "five_day_close",
  {
    title: "Five-day close workflow",
    description:
      "Run the six-gate five-day close reference: source freeze, subledger " +
      "cutoffs, reconciliation queue, evidence bundle, exception SLA, and " +
      "controller sign-off. Classifies AP exceptions when invoices are " +
      "supplied, optionally flashes covenants, and returns operator metrics " +
      "(straight-through rate, double-handling minutes, stale-input rate, " +
      "hours-to-close).",
    inputSchema: { close: closePayloadParam },
  },
  async ({ close }) => jsonResult(runFiveDayClose(close as unknown as CloseWorkflowInput)),
);

server.registerTool(
  "uipath_handoff",
  {
    title: "UiPath handoff",
    description:
      "Accept a UiPath payload and route it to the matching deterministic " +
      "engine: invoice audit, covenant certificate, contract evaluation, " +
      "AP exception classification, or five-day close.",
    inputSchema: uipathHandoffParam,
  },
  async ({
    kind,
    source,
    summary,
    invoices,
    items,
    trial_balance,
    period,
    config,
    prices,
    entry_lag_days,
    overdue_days,
    amount_outlier_multiple,
    rate_change_pct,
    min_invoices_for_baseline,
    close,
  }) => {
    const meta = {
      ok: true,
      kind,
      source: source ?? "uipath",
      summary,
    };

    if (kind === "audit_invoices") {
      if (!invoices) {
        throw new Error("UiPath audit handoff requires invoices");
      }

      const auditConfig: AuditConfig = {
        ...(config as AuditConfig | undefined),
        ...(entry_lag_days !== undefined ? { entry_lag_days } : {}),
        ...(overdue_days !== undefined ? { overdue_days } : {}),
        ...(amount_outlier_multiple !== undefined ? { amount_outlier_multiple } : {}),
        ...(rate_change_pct !== undefined ? { rate_change_pct } : {}),
        ...(min_invoices_for_baseline !== undefined ? { min_invoices_for_baseline } : {}),
      };

      return jsonResult({
        ...meta,
        result: runAllAuditRules(
          invoices as unknown as InvoiceRow[],
          (items ?? []) as unknown as ItemRow[],
          auditConfig,
        ),
      });
    }

    if (kind === "compliance_certificate") {
      if (!trial_balance || !period) {
        throw new Error("UiPath covenant handoff requires trial_balance and period");
      }

      const cfg = covenantCfg(config);
      const tb = toTrialBalance(trial_balance);
      const metrics = computeMetrics(tb, cfg);
      const results = evaluateCovenants(metrics, cfg);

      return jsonResult({
        ...meta,
        result: {
          metrics,
          results,
          certificate: certificateMarkdown(results, metrics, period),
        },
      });
    }

    if (kind === "classify_ap_exceptions") {
      if (!invoices) {
        throw new Error("UiPath AP-exception handoff requires invoices");
      }
      return jsonResult({
        ...meta,
        result: classifyApExceptions(
          invoices as unknown as ApInvoiceRow[],
          (items ?? []) as unknown as ItemRow[],
          (config as ApExceptionConfig | undefined) ?? {},
        ),
      });
    }

    if (kind === "five_day_close") {
      if (!close) {
        throw new Error("UiPath five-day-close handoff requires close payload");
      }
      return jsonResult({
        ...meta,
        result: runFiveDayClose(close as unknown as CloseWorkflowInput),
      });
    }

    const { cfg, px } = resolveMargin(config as Record<string, unknown> | undefined, prices);
    return jsonResult({
      ...meta,
      result: evaluateAllContracts(cfg, px),
    });
  },
);

// ------------------------------------------------------------------ main ----

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

function shutdown(): void {
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);
process.stdin.resume();

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
