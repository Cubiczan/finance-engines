// Five-day close readiness, gates, and operator metrics.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assessCloseReadiness,
  classifyApExceptions,
  defaultCloseWindowHours,
  hoursToClose,
  runFiveDayClose,
} from "../dist/index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../examples/five-day-close/fixture.json", import.meta.url), "utf8"),
);

function base(overrides = {}) {
  return {
    period: { label: "2026-06", period_end: "2026-06-30", target_close_hours: 120 },
    now: "2026-07-03T22:00:00Z",
    freeze_at: "2026-06-30T22:00:00Z",
    sources: [
      {
        system_id: "ns",
        erp: "netsuite",
        legal_entity: "US HoldCo",
        extract_id: "NS-1",
        extracted_at: "2026-06-30T20:00:00Z",
        as_of: "2026-06-30",
      },
    ],
    cutoffs: [
      { system_id: "ns", subledger: "ap", cutoff_at: "2026-06-30T21:00:00Z", frozen: true },
      { system_id: "ns", subledger: "ar", cutoff_at: "2026-06-30T21:00:00Z", frozen: true },
      { system_id: "ns", subledger: "inventory", cutoff_at: "2026-06-30T21:00:00Z", frozen: true },
      { system_id: "ns", subledger: "cash", cutoff_at: "2026-06-30T21:00:00Z", frozen: true },
    ],
    reconciliations: [
      {
        id: "r1",
        source_a: "ns/ap",
        source_b: "ns/gl",
        account: "AP",
        difference: 0,
        status: "cleared",
      },
    ],
    invoices: [
      {
        id: 1,
        invoice_number: "CLEAN",
        supplier_id: 1,
        supplier_name: "Vendor 1",
        issue_date: "2026-06-01",
        create_date: "2026-06-02",
        sum: 100,
        status: 2,
      },
    ],
    ...overrides,
  };
}

test("default close window is five days (120 hours)", () => {
  assert.equal(defaultCloseWindowHours(), 120);
});

test("hours-to-close uses freeze and injectable now", () => {
  const hours = hoursToClose(base());
  assert.equal(hours, 72);
});

test("stale extract is inventoried", () => {
  const report = assessCloseReadiness(
    base({
      now: "2026-07-04T18:00:00Z",
      sources: [
        {
          system_id: "xero",
          erp: "xero",
          legal_entity: "UK",
          extract_id: "XR-1",
          extracted_at: "2026-06-28T10:00:00Z",
          as_of: "2026-06-30",
        },
      ],
    }),
  );
  assert.equal(report.stale_inputs.length, 1);
  assert.equal(report.stale_inputs[0].system_id, "xero");
  assert.ok(report.metrics.stale_input_rate > 0);
});

test("missing required system is stale/missing", () => {
  const report = assessCloseReadiness(
    base({
      config: { required_systems: ["ns", "sap"] },
    }),
  );
  assert.deepEqual(report.missing_systems, ["sap"]);
});

test("source freeze completes when extracts precede freeze", () => {
  const report = runFiveDayClose(base());
  const freeze = report.gates.find((g) => g.id === "source_freeze");
  assert.equal(freeze.status, "complete");
});

test("extract after freeze blocks source freeze", () => {
  const report = runFiveDayClose(
    base({
      sources: [
        {
          system_id: "ns",
          erp: "netsuite",
          legal_entity: "US",
          extract_id: "late",
          extracted_at: "2026-07-01T08:00:00Z",
          as_of: "2026-06-30",
        },
      ],
    }),
  );
  assert.equal(report.gates.find((g) => g.id === "source_freeze").status, "blocked");
});

test("unfrozen subledger blocks cutoffs", () => {
  const report = runFiveDayClose(
    base({
      cutoffs: [
        { system_id: "ns", subledger: "ap", cutoff_at: "2026-06-30T21:00:00Z", frozen: false },
        { system_id: "ns", subledger: "ar", cutoff_at: "2026-06-30T21:00:00Z", frozen: true },
        { system_id: "ns", subledger: "inventory", cutoff_at: "2026-06-30T21:00:00Z", frozen: true },
        { system_id: "ns", subledger: "cash", cutoff_at: "2026-06-30T21:00:00Z", frozen: true },
      ],
    }),
  );
  assert.equal(report.gates.find((g) => g.id === "subledger_cutoffs").status, "blocked");
});

test("open reconciliation blocks the queue", () => {
  const report = runFiveDayClose(
    base({
      reconciliations: [
        {
          id: "open",
          source_a: "a",
          source_b: "b",
          account: "IC",
          difference: 12,
          status: "open",
        },
      ],
    }),
  );
  const rec = report.gates.find((g) => g.id === "reconciliation_queue");
  assert.equal(rec.status, "blocked");
  assert.equal(report.metrics.reconciliation_coverage, 0);
});

test("exception SLA blocks when open past sla_hours", () => {
  const report = runFiveDayClose(
    base({
      invoices: [
        {
          id: 1,
          invoice_number: "A1",
          supplier_id: 1,
          supplier_name: "Vendor 1",
          issue_date: "2026-06-01",
          create_date: "2026-06-02",
          sum: 100,
          status: 2,
          requires_po: true,
        },
      ],
    }),
  );
  assert.equal(report.gates.find((g) => g.id === "exception_sla").status, "blocked");
  assert.equal(report.exceptions[0].code, "missing_po");
});

test("straight-through rate is exception-free / total", () => {
  const invoices = [
    {
      id: 1,
      invoice_number: "CLEAN",
      supplier_id: 1,
      supplier_name: "V",
      issue_date: "2026-06-01",
      create_date: "2026-06-02",
      sum: 10,
      status: 2,
    },
    {
      id: 2,
      invoice_number: "DIRTY",
      supplier_id: 1,
      supplier_name: "V",
      issue_date: "2026-06-01",
      create_date: "2026-06-02",
      sum: 10,
      status: 2,
      requires_approval: true,
    },
  ];
  const report = runFiveDayClose(base({ invoices }));
  assert.equal(report.metrics.invoices_total, 2);
  assert.equal(report.metrics.invoices_straight_through, 1);
  assert.equal(report.metrics.straight_through_rate, 0.5);
});

test("happy-path close can reach sign-off", () => {
  const report = runFiveDayClose(
    base({
      signoff: { controller: "A. Controller", signed_at: "2026-07-03T21:00:00Z" },
    }),
  );
  const byId = Object.fromEntries(report.gates.map((g) => [g.id, g.status]));
  assert.equal(byId.source_freeze, "complete");
  assert.equal(byId.subledger_cutoffs, "complete");
  assert.equal(byId.reconciliation_queue, "complete");
  assert.equal(byId.evidence_bundle, "complete");
  assert.equal(byId.exception_sla, "complete");
  assert.equal(byId.controller_signoff, "complete");
  assert.equal(report.signoff_ready, true);
  assert.equal(report.metrics.hours_to_close, 71);
});

test("covenant flash attaches a certificate and can block sign-off", () => {
  const report = runFiveDayClose({
    ...fixture,
    reconciliations: fixture.reconciliations.map((r) =>
      r.status === "open" ? { ...r, status: "explained" } : r,
    ),
    invoices: fixture.invoices.filter((i) => ["NS-1001", "NS-1002", "SAP-2001", "XR-3001"].includes(i.invoice_number)),
    now: "2026-07-02T10:00:00Z",
  });
  assert.ok(report.covenant);
  assert.equal(report.covenant.all_compliant, false);
  assert.ok(report.covenant.certificate.includes("Covenant Compliance Certificate"));
  assert.ok(report.evidence.some((e) => e.kind === "covenant_certificate"));
  assert.equal(report.gates.find((g) => g.id === "controller_signoff").status, "blocked");
});

test("example fixture is a mid-close reference with all taxonomy codes", () => {
  const report = runFiveDayClose(fixture);
  const codes = new Set(report.exceptions.map((e) => e.code));
  for (const code of [
    "duplicate_invoice",
    "missing_po",
    "mismatched_po",
    "missing_receipt",
    "wrong_legal_entity",
    "tax_review",
    "ownerless_approval",
  ]) {
    assert.ok(codes.has(code), `fixture missing ${code}`);
  }
  assert.equal(report.metrics.invoices_total, 13);
  assert.equal(report.metrics.invoices_straight_through, 4);
  assert.equal(report.metrics.hours_to_close, 92);
  assert.deepEqual(
    report.readiness.stale_inputs.map((s) => s.system_id),
    ["xero-uk"],
  );
  assert.equal(report.metrics.stale_input_rate, 0.3333);
  assert.equal(report.gates.find((g) => g.id === "source_freeze").status, "complete");
  assert.equal(report.gates.find((g) => g.id === "reconciliation_queue").status, "blocked");
  assert.equal(report.gates.find((g) => g.id === "exception_sla").status, "blocked");
  assert.equal(report.signoff_ready, false);
  assert.equal(report.metrics.double_handling_minutes, 44);

  const again = classifyApExceptions(fixture.invoices, fixture.items);
  assert.equal(again.length, report.exceptions.length);
});
