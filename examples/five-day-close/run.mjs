#!/usr/bin/env node
/**
 * Runnable five-day close reference.
 *
 *   npm run example:close
 *   node examples/five-day-close/run.mjs
 *
 * Reads the synthetic multi-ERP fixture next to this file and prints gate
 * status plus operator metrics. Fully offline.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { apExceptionTaxonomy, runFiveDayClose } from "../../dist/index.js";

const fixturePath = fileURLToPath(new URL("./fixture.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const report = runFiveDayClose(fixture);

const pct = (n) => `${(n * 100).toFixed(1)}%`;

console.log(`Five-day close — ${report.period}  (now ${report.now})`);
console.log("");
console.log("Gates");
for (const g of report.gates) {
  const mark =
    g.status === "complete" ? "ok" : g.status === "blocked" ? "BLOCKED" : g.status;
  console.log(`  D${g.day}  ${g.label.padEnd(22)} ${mark.padEnd(12)} ${g.detail}`);
}
console.log("");
console.log("Metrics (illustrative)");
console.log(`  straight-through rate     ${pct(report.metrics.straight_through_rate)}  (${report.metrics.invoices_straight_through}/${report.metrics.invoices_total} invoices)`);
console.log(`  double-handling minutes   ${report.metrics.double_handling_minutes}  (synthetic table + extra touches)`);
console.log(`  stale-input rate          ${pct(report.metrics.stale_input_rate)}  (${report.readiness.stale_inputs.map((s) => s.system_id).join(", ") || "none"})`);
console.log(`  hours-to-close            ${report.metrics.hours_to_close}  (target ${report.metrics.target_close_hours})`);
console.log(`  reconciliation coverage   ${pct(report.metrics.reconciliation_coverage)}`);
console.log(`  sign-off ready            ${report.signoff_ready}`);
console.log("");
console.log("AP exceptions");
for (const ex of report.exceptions) {
  console.log(
    `  ${ex.code.padEnd(22)} ${ex.reason_code.padEnd(20)} ${ex.invoice_number.padEnd(12)} conf=${ex.confidence}`,
  );
}
console.log("");
console.log(`Covenant flash: ${report.covenant ? (report.covenant.all_compliant ? "all compliant" : "BREACH") : "n/a"}`);
if (report.covenant) {
  for (const r of report.covenant.results) {
    console.log(`  ${r.name}: ${r.compliant ? "COMPLIANT" : "BREACH"}`);
  }
}
console.log("");
console.log(`Taxonomy codes: ${apExceptionTaxonomy().map((t) => t.code).join(", ")}`);
console.log("");
console.log(
  JSON.stringify(
    {
      gates: report.gates.map((g) => ({ id: g.id, day: g.day, status: g.status })),
      metrics: report.metrics,
      signoff_ready: report.signoff_ready,
      exception_codes: report.exceptions.map((e) => e.code),
    },
    null,
    2,
  ),
);
