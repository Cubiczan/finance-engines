// AP exception taxonomy and classifier. Extends invoice-audit duplicates
// rather than inventing a second normalizer.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AP_EXCEPTION_CODES,
  apExceptionTaxonomy,
  classifyApExceptions,
  DEFAULT_HANDLING_MINUTES,
  doubleHandlingMinutes,
  normalizeInvoiceNumber,
  runAllAuditRules,
  runInvoiceReview,
  straightThroughRate,
} from "../dist/index.js";

function inv(id, num, extra = {}) {
  return {
    id,
    invoice_number: num,
    supplier_id: extra.supplier_id ?? 1,
    supplier_name: extra.supplier_name ?? `Vendor ${extra.supplier_id ?? 1}`,
    issue_date: extra.issue_date ?? "2026-06-01",
    create_date: extra.create_date ?? "2026-06-02",
    required_date: extra.required_date ?? "2026-07-01",
    sum: extra.sum ?? 1000,
    net_sum: extra.sum ?? 1000,
    sum_paid: extra.sum_paid ?? 0,
    status: extra.status ?? 2,
    currency: "USD",
    ...extra,
  };
}

function item(invId, name, price, tax = null) {
  return {
    invoice_id: invId,
    name,
    price,
    quantity: null,
    line_sum: price,
    tax_percent: tax,
  };
}

test("taxonomy lists every required code with reason codes", () => {
  const tax = apExceptionTaxonomy();
  assert.deepEqual(
    tax.map((t) => t.code),
    [...AP_EXCEPTION_CODES],
  );
  for (const entry of tax) {
    assert.ok(entry.reason_codes.length >= 1, entry.code);
    assert.equal(entry.handling_minutes, DEFAULT_HANDLING_MINUTES[entry.code]);
  }
});

test("duplicate exceptions reuse audit normalize + duplicateNumbers", () => {
  const invoices = [
    inv(1, "INV100"),
    inv(2, "#INV100"),
  ];
  assert.equal(normalizeInvoiceNumber("INV100"), normalizeInvoiceNumber("#INV100"));
  const findings = runAllAuditRules(invoices, [], { today: "2026-07-03" });
  assert.ok(findings.some((f) => f.rule === "duplicate_invoice_number"));
  const exceptions = classifyApExceptions(invoices);
  const dups = exceptions.filter((e) => e.code === "duplicate_invoice");
  assert.equal(dups.length, 2);
  assert.ok(dups.every((e) => e.reason_code === "DUP-NORM-COLLISION"));
  assert.ok(dups.every((e) => e.audit_rule === "duplicate_invoice_number"));
  assert.ok(dups.every((e) => e.confidence === 0.9));
});

test("missing PO", () => {
  const [ex] = classifyApExceptions([inv(1, "A1", { requires_po: true })]);
  assert.equal(ex.code, "missing_po");
  assert.equal(ex.reason_code, "PO-ABSENT");
  assert.equal(ex.confidence, 0.99);
});

test("mismatched PO number and amount", () => {
  const exceptions = classifyApExceptions([
    inv(1, "A1", {
      po_number: "PO-88",
      expected_po_number: "PO-90",
      po_amount: 800,
      sum: 1000,
      requires_po: true,
    }),
  ]);
  const codes = exceptions.map((e) => e.reason_code).sort();
  assert.deepEqual(codes, ["PO-AMOUNT-MISMATCH", "PO-NUMBER-MISMATCH"]);
});

test("missing receipt and qty short", () => {
  const absent = classifyApExceptions([
    inv(1, "A1", { receipt_required: true }),
  ]);
  assert.equal(absent[0].code, "missing_receipt");
  assert.equal(absent[0].reason_code, "RCV-ABSENT");

  const short = classifyApExceptions([
    inv(2, "A2", { receipt_id: "R-1", received_qty: 2, billed_qty: 5 }),
  ]);
  assert.equal(short[0].reason_code, "RCV-QTY-SHORT");
});

test("wrong legal entity", () => {
  const [ex] = classifyApExceptions([
    inv(1, "A1", { legal_entity: "US HoldCo", expected_legal_entity: "DE OpCo GmbH" }),
  ]);
  assert.equal(ex.code, "wrong_legal_entity");
  assert.equal(ex.reason_code, "LE-MISMATCH");
});

test("tax review flag, code mismatch, and inconsistent tax reuse", () => {
  const flagged = classifyApExceptions([inv(1, "A1", { tax_review_required: true })]);
  assert.equal(flagged[0].reason_code, "TAX-FLAG-REVIEW");

  const mismatch = classifyApExceptions([
    inv(2, "A2", { tax_code: "VAT-0", expected_tax_code: "VAT-19" }),
  ]);
  assert.equal(mismatch[0].reason_code, "TAX-CODE-MISMATCH");

  const invoices = [
    inv(3, "A3", { issue_date: "2026-03-27" }),
    inv(4, "A4", { issue_date: "2026-04-15" }),
  ];
  const items = [
    item(3, "Disposal (BBL)", 1.5, 8.625),
    item(4, "Disposal (BBL)", 1.5, null),
  ];
  const reused = classifyApExceptions(invoices, items).filter(
    (e) => e.reason_code === "TAX-INCONSISTENT",
  );
  assert.equal(reused.length, 1);
  assert.equal(reused[0].audit_rule, "inconsistent_tax");
});

test("ownerless approval", () => {
  const [ex] = classifyApExceptions([inv(1, "A1", { requires_approval: true })]);
  assert.equal(ex.code, "ownerless_approval");
  assert.equal(ex.reason_code, "APPR-NO-OWNER");
});

test("clean invoice without match fields is straight-through", () => {
  const invoices = [inv(1, "CLEAN-1")];
  const exceptions = classifyApExceptions(invoices);
  assert.deepEqual(exceptions, []);
  assert.equal(straightThroughRate({ invoices, exceptions }), 1);
});

test("invoices omitting match fields are not flagged for PO/receipt rules", () => {
  const exceptions = classifyApExceptions([inv(1, "PLAIN")]);
  assert.equal(
    exceptions.filter((e) =>
      ["missing_po", "mismatched_po", "missing_receipt", "wrong_legal_entity", "ownerless_approval"].includes(
        e.code,
      ),
    ).length,
    0,
  );
});

test("classification is deterministic", () => {
  const invoices = [
    inv(1, "INV100"),
    inv(2, "#INV100"),
    inv(3, "B1", { requires_po: true }),
  ];
  assert.deepEqual(classifyApExceptions(invoices), classifyApExceptions(invoices));
});

test("runInvoiceReview keeps classic findings unchanged", () => {
  const invoices = [inv(1, "INV100"), inv(2, "#INV100")];
  const review = runInvoiceReview(invoices, [], { today: "2026-07-03" });
  const classic = runAllAuditRules(invoices, [], { today: "2026-07-03" });
  assert.deepEqual(review.findings, classic);
  assert.ok(review.exceptions.some((e) => e.code === "duplicate_invoice"));
});

test("double-handling counts extra exceptions and retouches", () => {
  const invoices = [
    inv(1, "A1", {
      legal_entity: "US",
      expected_legal_entity: "DE",
      requires_approval: true,
      handling_touches: 3,
    }),
  ];
  const exceptions = classifyApExceptions(invoices);
  assert.equal(exceptions.length, 2);
  const minutes = doubleHandlingMinutes({ invoices, exceptions });
  // second exception (ownerless 20) + 2 extra touches * 12
  assert.equal(minutes, DEFAULT_HANDLING_MINUTES.ownerless_approval + 24);
});
