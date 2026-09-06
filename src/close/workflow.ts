/**
 * Multi-ERP five-day close reference workflow.
 *
 * Evaluates six gates (source freeze, subledger cutoffs, reconciliation
 * queue, evidence bundle, exception SLA, controller sign-off), assembles
 * an evidence bundle, and optionally flashes covenants through the
 * existing covenant engine. Deterministic: all clocks come from the input.
 */

import { classifyApExceptions } from "../audit/exceptions.js";
import { defaultCovenantConfig } from "../covenant/defaults.js";
import {
  certificateMarkdown,
  computeMetrics,
  evaluateCovenants,
} from "../covenant/engine.js";
import { parseIsoDateTime } from "../internal/dates.js";
import { assessCloseReadiness, resolveCloseConfig } from "./readiness.js";
import type {
  CloseException,
  CloseGateId,
  CloseGateResult,
  CloseGateStatus,
  CloseWorkflowInput,
  CloseWorkflowReport,
  CovenantFlash,
  EvidenceArtifact,
} from "./types.js";
import { CLOSE_GATES, DEFAULT_CLOSE_CONFIG, GATE_DAYS } from "./types.js";

function gate(
  id: CloseGateId,
  status: CloseGateStatus,
  detail: string,
): CloseGateResult {
  const meta = GATE_DAYS[id];
  return { id, day: meta.day, label: meta.label, status, detail };
}

function resolveExceptions(input: CloseWorkflowInput): CloseException[] {
  if (input.exceptions) {
    return input.exceptions.map((ex) => ({
      ...ex,
      status: ex.status ?? "open",
      opened_at: ex.opened_at ?? input.freeze_at,
      sla_hours: ex.sla_hours ?? resolveCloseConfig(input.config).exception_sla_hours,
    }));
  }
  const invoices = input.invoices ?? [];
  const classified = classifyApExceptions(invoices, input.items ?? [], input.config);
  const sla = resolveCloseConfig(input.config).exception_sla_hours;
  return classified.map((ex) => ({
    ...ex,
    status: "open" as const,
    opened_at: input.freeze_at,
    sla_hours: sla,
  }));
}

function freezeGate(input: CloseWorkflowInput): CloseGateResult {
  if (!input.freeze_at) {
    return gate(
      "source_freeze",
      input.sources.length ? "in_progress" : "not_started",
      input.sources.length
        ? "Extracts present but freeze timestamp is not set"
        : "No ERP extracts and no freeze timestamp",
    );
  }
  const freezeMs = parseIsoDateTime(input.freeze_at);
  if (freezeMs === null) {
    return gate("source_freeze", "blocked", `Invalid freeze_at '${input.freeze_at}'`);
  }
  if (input.sources.length === 0) {
    return gate("source_freeze", "blocked", "Freeze set but no ERP extracts were supplied");
  }
  const late = input.sources.filter((s) => {
    const ms = parseIsoDateTime(s.extracted_at);
    return ms === null || ms > freezeMs;
  });
  if (late.length) {
    return gate(
      "source_freeze",
      "blocked",
      `${late.length} extract(s) taken after freeze (${late.map((s) => s.system_id).join(", ")})`,
    );
  }
  return gate(
    "source_freeze",
    "complete",
    `All ${input.sources.length} extract(s) taken at or before ${input.freeze_at}`,
  );
}

function cutoffGate(input: CloseWorkflowInput, cfg: ReturnType<typeof resolveCloseConfig>): CloseGateResult {
  const cutoffs = input.cutoffs ?? [];
  const systems = cfg.required_systems?.length
    ? cfg.required_systems
    : [...new Set(input.sources.map((s) => s.system_id))];
  const required = cfg.required_subledgers;
  if (systems.length === 0 && cutoffs.length === 0) {
    return gate("subledger_cutoffs", "not_started", "No systems or cutoffs supplied");
  }
  const missing: string[] = [];
  const unfrozen: string[] = [];
  for (const systemId of systems) {
    for (const sub of required) {
      const row = cutoffs.find(
        (c) => c.system_id === systemId && c.subledger === sub,
      );
      const key = `${systemId}/${sub}`;
      if (!row) missing.push(key);
      else if (!row.frozen) unfrozen.push(key);
    }
  }
  if (missing.length === 0 && unfrozen.length === 0) {
    return gate(
      "subledger_cutoffs",
      "complete",
      `Required subledgers frozen for ${systems.length} system(s)`,
    );
  }
  if (cutoffs.some((c) => c.frozen) && (missing.length || unfrozen.length)) {
    return gate(
      "subledger_cutoffs",
      "blocked",
      [
        missing.length ? `missing ${missing.join(", ")}` : "",
        unfrozen.length ? `unfrozen ${unfrozen.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  return gate("subledger_cutoffs", "in_progress", "Cutoff list is incomplete");
}

function recGate(input: CloseWorkflowInput, cfg: ReturnType<typeof resolveCloseConfig>): CloseGateResult {
  const items = input.reconciliations ?? [];
  if (items.length === 0) {
    return gate("reconciliation_queue", "not_started", "Reconciliation queue is empty");
  }
  const covered = items.filter((r) => r.status === "cleared" || r.status === "explained");
  const open = items.filter((r) => r.status === "open");
  const coverage = covered.length / items.length;
  if (coverage >= cfg.min_reconciliation_coverage && (!cfg.require_recs_cleared || open.length === 0)) {
    return gate(
      "reconciliation_queue",
      "complete",
      `${covered.length}/${items.length} items cleared or explained`,
    );
  }
  if (open.length) {
    return gate(
      "reconciliation_queue",
      "blocked",
      `${open.length} open item(s); coverage ${covered.length}/${items.length}`,
    );
  }
  return gate(
    "reconciliation_queue",
    "in_progress",
    `Coverage ${covered.length}/${items.length} below threshold ${cfg.min_reconciliation_coverage}`,
  );
}

function evidenceGate(
  evidence: EvidenceArtifact[],
  cfg: ReturnType<typeof resolveCloseConfig>,
): CloseGateResult {
  if (evidence.length === 0) {
    return gate("evidence_bundle", "not_started", "Evidence bundle is empty");
  }
  const kinds = new Set(evidence.map((e) => e.kind));
  const missing = cfg.required_evidence_kinds.filter((k) => !kinds.has(k));
  if (missing.length === 0) {
    return gate(
      "evidence_bundle",
      "complete",
      `${evidence.length} artifact(s); required kinds present`,
    );
  }
  return gate(
    "evidence_bundle",
    "blocked",
    `Missing artifact kind(s): ${missing.join(", ")}`,
  );
}

function slaGate(
  input: CloseWorkflowInput,
  exceptions: CloseException[],
  cfg: ReturnType<typeof resolveCloseConfig>,
): CloseGateResult {
  if ((input.invoices?.length ?? 0) === 0 && exceptions.length === 0) {
    return gate("exception_sla", "not_started", "No invoices or exceptions supplied");
  }
  const nowMs = parseIsoDateTime(input.now);
  if (nowMs === null) {
    return gate("exception_sla", "blocked", `Invalid now '${input.now}'`);
  }
  const open = exceptions.filter((e) => (e.status ?? "open") === "open");
  const past: CloseException[] = [];
  for (const ex of open) {
    const opened = parseIsoDateTime(ex.opened_at ?? input.freeze_at);
    const sla = ex.sla_hours ?? cfg.exception_sla_hours;
    if (opened !== null && nowMs > opened + sla * 3_600_000) past.push(ex);
  }
  if (open.length === 0) {
    return gate(
      "exception_sla",
      "complete",
      exceptions.length
        ? "All exceptions resolved or waived"
        : "No AP exceptions in the corpus",
    );
  }
  if (past.length) {
    return gate(
      "exception_sla",
      "blocked",
      `${past.length} open exception(s) past SLA (${cfg.exception_sla_hours}h)`,
    );
  }
  return gate(
    "exception_sla",
    "in_progress",
    `${open.length} open exception(s) still inside SLA`,
  );
}

function signoffGate(
  input: CloseWorkflowInput,
  prior: CloseGateResult[],
  covenant: CovenantFlash | undefined,
  cfg: ReturnType<typeof resolveCloseConfig>,
): CloseGateResult {
  const priorBlocked = prior.filter((g) => g.status !== "complete");
  const signed = Boolean(input.signoff?.signed_at);
  if (covenant && !covenant.all_compliant && cfg.block_signoff_on_covenant_breach) {
    return gate(
      "controller_signoff",
      "blocked",
      "Covenant breach blocks controller sign-off",
    );
  }
  if (priorBlocked.length) {
    return gate(
      "controller_signoff",
      signed ? "blocked" : "not_started",
      `Prior gate(s) not complete: ${priorBlocked.map((g) => g.id).join(", ")}`,
    );
  }
  if (signed) {
    return gate(
      "controller_signoff",
      "complete",
      `Signed by ${input.signoff?.controller ?? "controller"} at ${input.signoff?.signed_at}`,
    );
  }
  return gate("controller_signoff", "in_progress", "Prior gates complete; awaiting signature");
}

function assembleEvidence(
  input: CloseWorkflowInput,
  exceptions: CloseException[],
  covenant: CovenantFlash | undefined,
): EvidenceArtifact[] {
  const evidence = [...(input.evidence ?? [])];
  const kinds = new Set(evidence.map((e) => e.kind));
  if (!kinds.has("extract")) {
    for (const src of input.sources) {
      evidence.push({
        id: `extract:${src.extract_id || src.system_id}`,
        kind: "extract",
        source: src.system_id,
        checksum: src.checksum,
        produced_at: src.extracted_at,
        generated: true,
      });
    }
  }
  if (!kinds.has("reconciliation") && (input.reconciliations?.length ?? 0) > 0) {
    evidence.push({
      id: "reconciliation:queue",
      kind: "reconciliation",
      source: "close-workflow",
      produced_at: input.now,
      generated: true,
    });
  }
  if (!kinds.has("exception_queue")) {
    evidence.push({
      id: `exception_queue:ap:${exceptions.length}`,
      kind: "exception_queue",
      source: "classifyApExceptions",
      produced_at: input.now,
      generated: true,
    });
  }
  if (covenant && !kinds.has("covenant_certificate")) {
    evidence.push({
      id: "covenant:certificate",
      kind: "covenant_certificate",
      source: "evaluateCovenants",
      produced_at: input.now,
      generated: true,
    });
  }
  if (input.signoff?.signed_at && !kinds.has("signoff")) {
    evidence.push({
      id: "signoff:controller",
      kind: "signoff",
      source: input.signoff.controller,
      produced_at: input.signoff.signed_at,
      generated: true,
    });
  }
  return evidence;
}

function covenantFlash(input: CloseWorkflowInput): CovenantFlash | undefined {
  if (!input.trial_balance) return undefined;
  const cfg = input.covenant_config ?? defaultCovenantConfig;
  const metrics = computeMetrics(input.trial_balance, cfg);
  const results = evaluateCovenants(metrics, cfg);
  const period = input.covenant_period ?? input.period.label;
  return {
    metrics,
    results,
    certificate: certificateMarkdown(results, metrics, period),
    all_compliant: results.every((r) => r.compliant),
  };
}

/** Run the six-gate reference close. */
export function runFiveDayClose(input: CloseWorkflowInput): CloseWorkflowReport {
  const cfg = resolveCloseConfig(input.config);
  const exceptions = resolveExceptions(input);
  const covenant = covenantFlash(input);
  const evidence = assembleEvidence(input, exceptions, covenant);

  const gates: CloseGateResult[] = [];
  gates.push(freezeGate(input));
  gates.push(cutoffGate(input, cfg));
  gates.push(recGate(input, cfg));
  gates.push(evidenceGate(evidence, cfg));
  gates.push(slaGate(input, exceptions, cfg));
  const prior = gates.slice();
  gates.push(signoffGate(input, prior, covenant, cfg));

  const readiness = assessCloseReadiness(input, { exceptions, gates });
  const signoff = gates.find((g) => g.id === "controller_signoff");
  const signoffReady =
    prior.every((g) => g.status === "complete") &&
    signoff?.status !== "blocked" &&
    !(covenant && !covenant.all_compliant && cfg.block_signoff_on_covenant_breach);

  return {
    period: input.period.label,
    now: input.now,
    gates,
    readiness,
    exceptions,
    metrics: readiness.metrics,
    evidence,
    ...(covenant ? { covenant } : {}),
    signoff_ready: signoffReady,
  };
}

export function closeGateOrder(): CloseGateId[] {
  return [...CLOSE_GATES];
}

export function defaultCloseWindowHours(): number {
  return DEFAULT_CLOSE_CONFIG.target_close_hours;
}
