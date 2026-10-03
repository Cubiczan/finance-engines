/-
  Finance.lean — Lean 4 (core library only) formal model of the
  finance-engines covenant engine and five-day close workflow.

  Sources modelled (follow the CODE, not the docs, where they differ):
    * src/covenant/engine.ts  — computeMetrics (ll. 199–229),
      evaluateCovenants (ll. 231–259)
    * src/covenant/defaults.ts — the shipped covenant set
    * src/close/workflow.ts   — the six gates (freezeGate ll. 60–93,
      cutoffGate ll. 95–136, recGate ll. 138–165, evidenceGate
      ll. 167–188, slaGate ll. 190–230, signoffGate ll. 232–262),
      runFiveDayClose assembly (ll. 337–371)

  JS numbers are IEEE-754 doubles; the model uses exact rationals (`Rat`).
  Everywhere the code's float behaviour can diverge from rational
  arithmetic (boundary comparisons, Infinity), that is flagged in
  NOTES.md rather than proved over floats. `Infinity` (produced by
  computeMetrics for debt_to_net_worth when equity ≤ 0) is modelled
  with the `ExtRat` type in §1.4.
-/

namespace FinanceEngines

/-! ## 1. Covenant evaluation (`evaluateCovenants`) -/

/-- The comparison operator. `CovenantSpec.operator` is typed
    `">=" | "<="` in TypeScript, but at runtime `evaluateCovenants`
    tests `op === ">="` and treats *every* other string as `<=`
    (engine.ts l. 240). -/
inductive Op where
  | ge
  | le
  deriving DecidableEq, Repr

/-- engine.ts l. 240: only the exact string `">="` selects the `>=`
    branch; anything else falls through to `<=`. -/
def opOf (s : String) : Op :=
  if s = ">=" then .ge else .le

theorem opOf_ge : opOf ">=" = .ge := rfl

theorem opOf_ne_ge {s : String} (h : s ≠ ">=") : opOf s = .le := by
  unfold opOf
  rw [ite_eq_right h]

/-- The compliance test of engine.ts l. 240:
    `op === ">=" ? value >= threshold : value <= threshold`. -/
def compliantB (op : Op) (v t : Rat) : Bool :=
  match op with
  | .ge => decide (t ≤ v)
  | .le => decide (v ≤ t)

theorem compliantB_ge {v t : Rat} :
    compliantB .ge v t = true ↔ t ≤ v := by
  simp [compliantB]

theorem compliantB_le {v t : Rat} :
    compliantB .le v t = true ↔ v ≤ t := by
  simp [compliantB]

theorem compliantB_ge_false {v t : Rat} :
    compliantB .ge v t = false ↔ v < t := by
  simp [compliantB, Rat.not_le]

theorem compliantB_le_false {v t : Rat} :
    compliantB .le v t = false ↔ t < v := by
  simp [compliantB, Rat.not_le]

/-- **Breach soundness (`>=`)**: whenever the engine reports BREACH for
    a `>=` covenant, the metric really is strictly past (below) the
    threshold. -/
theorem breach_ge_sound {v t : Rat}
    (h : compliantB .ge v t = false) : v < t :=
  compliantB_ge_false.mp h

/-- **Breach soundness (`<=`)**: a reported BREACH means the metric is
    strictly above the threshold. -/
theorem breach_le_sound {v t : Rat}
    (h : compliantB .le v t = false) : t < v :=
  compliantB_le_false.mp h

/-! ### 1.1 Arithmetic helpers over `Rat` (core-library only) -/

theorem abs_pos_of_ne {t : Rat} (ht : t ≠ 0) : 0 < Rat.abs t := by
  rcases (Rat.le_total (a := t) (b := 0)) with h | h
  · rw [Rat.abs_of_nonpos h]
    have h2 : (0 : Rat) ≤ -t := by
      have hh := Rat.neg_le_neg h
      rwa [Rat.neg_zero] at hh
    have h3 : (-t) ≠ 0 := by
      intro hz
      apply ht
      have h4 : t + -t = t + 0 := by rw [hz]
      rw [Rat.add_neg_cancel, Rat.add_zero] at h4
      exact h4.symm
    exact Rat.lt_of_le_of_ne h2 (Ne.symm h3)
  · rw [Rat.abs_of_nonneg h]
    exact Rat.lt_of_le_of_ne h (Ne.symm ht)

theorem abs_ne_zero {t : Rat} (ht : t ≠ 0) : Rat.abs t ≠ 0 := by
  intro hz
  have hpos := abs_pos_of_ne ht
  rw [hz] at hpos
  exact Rat.lt_irrefl hpos

theorem inv_nonneg_of_pos {b : Rat} (hb : 0 < b) : 0 ≤ b⁻¹ := by
  have hbne : b ≠ 0 := by
    intro e
    subst e
    exact Rat.lt_irrefl hb
  apply Rat.not_lt.mp
  intro h
  have hb0 : (0 : Rat) ≤ b := Rat.le_of_lt hb
  have hnb : (0 : Rat) ≤ -b⁻¹ := by
    have hh := Rat.neg_le_neg (Rat.le_of_lt h)
    rwa [Rat.neg_zero] at hh
  have hprod : (0 : Rat) ≤ b * -b⁻¹ := Rat.mul_nonneg hb0 hnb
  rw [Rat.mul_neg, Rat.mul_inv_cancel b hbne] at hprod
  exact Rat.not_le.mpr (show (-1 : Rat) < 0 by decide) hprod

theorem inv_ne_zero_of_ne {b : Rat} (hb : b ≠ 0) : b⁻¹ ≠ 0 := by
  intro hz
  have h1 := Rat.mul_inv_cancel b hb
  rw [hz, Rat.mul_zero] at h1
  exact (show (0 : Rat) ≠ 1 by decide) h1

/-- Sign of a product with a positive factor. -/
theorem mul_nonneg_iff_of_pos {x c : Rat} (hc : 0 < c) :
    (0 ≤ x * c) ↔ (0 ≤ x) := by
  constructor
  · intro h
    apply Rat.not_lt.mp
    intro hx
    have h1 : (0 : Rat) < -x := by
      have hh := Rat.neg_le_neg (Rat.le_of_lt hx)
      rw [Rat.neg_zero] at hh
      have hne : (-x) ≠ 0 := by
        intro hz
        have h4 : x + -x = x + 0 := by rw [hz]
        rw [Rat.add_neg_cancel, Rat.add_zero] at h4
        rw [← h4] at hx
        exact Rat.lt_irrefl hx
      exact Rat.lt_of_le_of_ne hh (Ne.symm hne)
    have h2 : (0 : Rat) < (-x) * c := Rat.mul_pos h1 hc
    have h3 : (-x) * c = -(x * c) := Rat.neg_mul x c
    rw [h3] at h2
    have h4 : -(x * c) ≤ 0 := by
      have hh := Rat.neg_le_neg h
      rwa [Rat.neg_zero] at hh
    exact Rat.not_lt.mpr h4 h2
  · intro h
    exact Rat.mul_nonneg h (Rat.le_of_lt hc)

/-- Sign of a quotient by `|t|` (positive when `t ≠ 0`). Division on
    `Rat` is definitionally multiplication by the inverse. -/
theorem div_nonneg_iff_of_abs {x t : Rat} (ht : t ≠ 0) :
    (0 ≤ x / Rat.abs t) ↔ (0 ≤ x) :=
  mul_nonneg_iff_of_pos (Rat.inv_pos.mpr (abs_pos_of_ne ht))

theorem sub_nonneg_iff {a b : Rat} : (0 ≤ a - b) ↔ b ≤ a := by
  constructor
  · intro h
    have h2 : b + (0 : Rat) ≤ b + (a - b) := (Rat.add_le_add_left).mpr h
    rw [Rat.add_zero] at h2
    have h3 : b + (a - b) = a := by
      rw [Rat.sub_eq_add_neg, ← Rat.add_assoc, Rat.add_comm b a,
        Rat.add_assoc, Rat.add_neg_cancel, Rat.add_zero]
    rwa [h3] at h2
  · intro h
    have h2 : -b + b ≤ -b + a := (Rat.add_le_add_left).mpr h
    rwa [Rat.neg_add_cancel, Rat.add_comm (-b) a, ← Rat.sub_eq_add_neg] at h2

/-! ### 1.2 Headroom (`headroom_pct`, engine.ts ll. 241–245) -/

/-- engine.ts ll. 241–245:
    `threshold ? ((op === ">=" ? value - threshold : threshold - value)
    / Math.abs(threshold)) * 100 : 0.0`.
    A zero threshold therefore reports headroom `0` unconditionally. -/
def headroom (op : Op) (v t : Rat) : Rat :=
  if t = 0 then 0
  else ((match op with | .ge => v - t | .le => t - v) / Rat.abs t) * 100

/-- **Headroom sign is correct** (for nonzero thresholds): the reported
    headroom is nonnegative exactly when the covenant is compliant, for
    both operator directions. -/
theorem headroom_sign_iff {op : Op} {v t : Rat} (ht : t ≠ 0) :
    (0 ≤ headroom op v t) ↔ compliantB op v t = true := by
  unfold headroom
  rw [ite_eq_right ht]
  cases op with
  | ge =>
      show (0 ≤ ((v - t) / Rat.abs t) * 100) ↔ compliantB .ge v t = true
      rw [mul_nonneg_iff_of_pos (show (0 : Rat) < 100 by decide),
        div_nonneg_iff_of_abs ht, sub_nonneg_iff]
      exact compliantB_ge.symm
  | le =>
      show (0 ≤ ((t - v) / Rat.abs t) * 100) ↔ compliantB .le v t = true
      rw [mul_nonneg_iff_of_pos (show (0 : Rat) < 100 by decide),
        div_nonneg_iff_of_abs ht, sub_nonneg_iff]
      exact compliantB_le.symm

/-- Boundary case of the sign theorem: at a nonzero threshold, headroom
    is exactly `0` iff the metric sits exactly on the threshold (which
    is compliant for both operators). -/
theorem headroom_ge_eq_zero_iff {v t : Rat} (ht : t ≠ 0) :
    headroom .ge v t = 0 ↔ v = t := by
  unfold headroom
  rw [ite_eq_right ht]
  show ((v - t) / Rat.abs t) * 100 = 0 ↔ v = t
  constructor
  · intro h
    have h2 := Rat.mul_eq_zero.mp h
    cases h2 with
    | inr h100 => exact absurd h100 (by decide)
    | inl hd =>
        have h3 := Rat.mul_eq_zero.mp hd
        cases h3 with
        | inr hi => exact absurd hi (inv_ne_zero_of_ne (abs_ne_zero ht))
        | inl hdiff =>
            have h4 : v = (v - t) + t := by
              rw [Rat.sub_eq_add_neg, Rat.add_assoc, Rat.neg_add_cancel,
                Rat.add_zero]
            rw [hdiff, Rat.zero_add] at h4
            exact h4
  · intro h
    rw [h]
    show ((t - t) / Rat.abs t) * 100 = 0
    rw [Rat.sub_self]
    show (0 : Rat) * (Rat.abs t)⁻¹ * 100 = 0
    rw [Rat.zero_mul, Rat.zero_mul]

theorem headroom_le_eq_zero_iff {v t : Rat} (ht : t ≠ 0) :
    headroom .le v t = 0 ↔ v = t := by
  unfold headroom
  rw [ite_eq_right ht]
  show ((t - v) / Rat.abs t) * 100 = 0 ↔ v = t
  constructor
  · intro h
    have h2 := Rat.mul_eq_zero.mp h
    cases h2 with
    | inr h100 => exact absurd h100 (by decide)
    | inl hd =>
        have h3 := Rat.mul_eq_zero.mp hd
        cases h3 with
        | inr hi => exact absurd hi (inv_ne_zero_of_ne (abs_ne_zero ht))
        | inl hdiff =>
            have h4 : t = (t - v) + v := by
              rw [Rat.sub_eq_add_neg, Rat.add_assoc, Rat.neg_add_cancel,
                Rat.add_zero]
            rw [hdiff, Rat.zero_add] at h4
            exact h4.symm
  · intro h
    rw [h]
    show ((t - t) / Rat.abs t) * 100 = 0
    rw [Rat.sub_self]
    show (0 : Rat) * (Rat.abs t)⁻¹ * 100 = 0
    rw [Rat.zero_mul, Rat.zero_mul]

/-- With a zero threshold the headroom is *defined* to be `0` — even
    when the covenant is in breach. The certificate therefore shows
    `0%` headroom on a BREACH row (see NOTES). -/
theorem headroom_zero_threshold (op : Op) (v : Rat) :
    headroom op v 0 = 0 := by
  unfold headroom
  rw [ite_eq_left rfl]

theorem headroom_zero_threshold_breach_example :
    compliantB .ge (-1) 0 = false ∧ headroom .ge (-1) 0 = 0 :=
  ⟨by decide, headroom_zero_threshold _ _⟩

/-! ### 1.3 Missing metrics (`metrics[cov.metric] ?? 0.0`, engine.ts l. 237) -/

/-- The metric lookup of `evaluateCovenants`: a metric absent from the
    computed-metrics record is silently replaced by `0.0`. -/
def valueOf (metrics : String → Option Rat) (name : String) : Rat :=
  match metrics name with
  | some v => v
  | none => 0

theorem valueOf_missing {metrics : String → Option Rat} {name : String}
    (h : metrics name = none) : valueOf metrics name = 0 := by
  unfold valueOf
  rw [h]

/-- **Fail-open on missing data**: a `<=` covenant (e.g. the default
    "Debt to Tangible Net Worth ≤ 3.0") whose metric is *missing*
    evaluates against the default value `0` and therefore reports
    COMPLIANT for every nonnegative threshold — no data required. -/
theorem missing_metric_le_passes {metrics : String → Option Rat}
    {name : String} (h : metrics name = none) {t : Rat} (ht : 0 ≤ t) :
    compliantB .le (valueOf metrics name) t = true := by
  rw [valueOf_missing h]
  exact compliantB_le.mpr ht

/-- The dual direction is fail-closed: a missing metric breaches a
    `>=` covenant with a positive threshold. -/
theorem missing_metric_ge_breaches {metrics : String → Option Rat}
    {name : String} (h : metrics name = none) {t : Rat} (ht : 0 < t) :
    compliantB .ge (valueOf metrics name) t = false := by
  rw [valueOf_missing h]
  exact compliantB_ge_false.mpr ht

/-! ### 1.4 Metric ratios (`computeMetrics`, engine.ts ll. 222–224) -/

/-- engine.ts l. 222: `currentLiabilities ? currentAssets /
    currentLiabilities : 0.0` — a zero (falsy) denominator yields the
    metric value `0`, not infinity or an error. -/
def currentRatio (ca cl : Rat) : Rat :=
  if cl = 0 then 0 else ca / cl

/-- engine.ts l. 223: `debtService ? ebitda / debtService : 0.0` — no
    configured debt service ⇒ DSCR reported as `0`. -/
def dscr (e ds : Rat) : Rat :=
  if ds = 0 then 0 else e / ds

theorem currentRatio_zero_denominator (ca : Rat) :
    currentRatio ca 0 = 0 := rfl

theorem dscr_zero_denominator (e : Rat) : dscr e 0 = 0 := rfl

/-- A borrower with *no current liabilities at all* gets current ratio
    `0` and breaches any positive `>=` current-ratio covenant. -/
theorem zero_current_liabilities_breach {t : Rat} (ht : 0 < t) (ca : Rat) :
    compliantB .ge (currentRatio ca 0) t = false := by
  rw [currentRatio_zero_denominator]
  exact compliantB_ge_false.mpr ht

/-- A borrower with no configured debt service breaches any positive
    `>=` DSCR covenant, whatever its EBITDA. -/
theorem zero_debt_service_breach {t : Rat} (ht : 0 < t) (e : Rat) :
    compliantB .ge (dscr e 0) t = false := by
  rw [dscr_zero_denominator]
  exact compliantB_ge_false.mpr ht

/-- Extended rationals: a finite value or `+Infinity`. JS produces the
    real `Infinity` here; `Rat` cannot, hence this type. -/
inductive ExtRat where
  | fin (q : Rat)
  | inf
  deriving DecidableEq, Repr

/-- engine.ts l. 224: `equity > 0 ? totalDebt / equity : Infinity`.
    Note `equity` here is the *computed* equity (matched equity
    accounts plus net income, l. 216). -/
def debtToNetWorth (debt equity : Rat) : ExtRat :=
  if 0 < equity then .fin (debt / equity) else .inf

/-- How a `<=` covenant test sees an `ExtRat`: `Infinity <= t` is
    false for every finite threshold `t` (JS semantics). -/
def extCompliantLe (x : ExtRat) (t : Rat) : Bool :=
  match x with
  | .fin q => compliantB .le q t
  | .inf => false

/-- Non-positive equity ⇒ `Infinity` ⇒ breach of every `<=`
    debt-to-net-worth covenant, for *any* finite threshold and any
    debt — including zero debt (see the corollary). -/
theorem dtnw_nonpos_equity (debt equity t : Rat) (h : equity ≤ 0) :
    extCompliantLe (debtToNetWorth debt equity) t = false := by
  have hne : ¬ (0 < equity) := Rat.not_lt.mpr h
  unfold debtToNetWorth extCompliantLe
  rw [ite_eq_right hne]

/-- Even a debt-free borrower (debt = 0) with zero equity is reported
    in BREACH of a `<=` debt-to-net-worth covenant, because the metric
    is `Infinity`, not `0`. -/
theorem dtnw_zero_debt_zero_equity_breaches (t : Rat) :
    extCompliantLe (debtToNetWorth 0 0) t = false :=
  dtnw_nonpos_equity 0 0 t Rat.le_refl

theorem dtnw_pos_equity (debt equity : Rat) (h : 0 < equity) :
    debtToNetWorth debt equity = .fin (debt / equity) := by
  unfold debtToNetWorth
  rw [ite_eq_left h]



/-! ## 2. The five-day close workflow (`src/close/workflow.ts`)

The workflow is a pure function: the six gates are evaluated in the
fixed `CLOSE_GATES` order (src/close/types.ts ll. 15–22), and the
sign-off gate is computed *from the other five statuses*. Each gate is
modelled at the level of the inputs its status actually depends on;
timestamps are modelled as integer milliseconds (the code compares
`parseIsoDateTime` results, which are ms since epoch or `null`). -/

/-- Gate statuses, mirroring `CloseGateStatus`
    (types.ts l. 26): "not_started" | "in_progress" | "blocked" |
    "complete". -/
inductive GateStatus where
  | notStarted
  | inProgress
  | blocked
  | complete
  deriving DecidableEq, Repr

/-! ### 2.1 Controller sign-off (`signoffGate`, workflow.ts ll. 232–262) -/

/-- The sign-off gate. `prior` is the list of the five prior gate
    statuses (in `CLOSE_GATES` order); `covBlock` abstracts the JS
    condition `covenant && !covenant.all_compliant &&
    cfg.block_signoff_on_covenant_breach`; `signed` is
    `Boolean(input.signoff?.signed_at)`.

    JS branch order: covenant block first, then prior-gate block, then
    signed ⇒ complete, else in_progress. The model checks the
    all-prior-complete condition in the middle instead; the resulting
    truth table is identical (verified by
    `signoffStatus_complete_iff` and the case analysis in its proof). -/
def signoffStatus (prior : List GateStatus) (covBlock signed : Bool) :
    GateStatus :=
  if covBlock = true then .blocked
  else if prior.all (fun g => decide (g = GateStatus.complete)) = true then
    (if signed = true then .complete else .inProgress)
  else (if signed = true then .blocked else .notStarted)

/-- **Sign-off completes only when every prior gate is complete**, no
    covenant block applies, and a signature exists. This is the
    load-bearing ordering property of the close: there is no path in
    `signoffGate` to `complete` with a prerequisite gate incomplete. -/
theorem signoffStatus_complete_iff {prior : List GateStatus}
    {covBlock signed : Bool} :
    signoffStatus prior covBlock signed = .complete ↔
      (∀ g ∈ prior, g = .complete) ∧ covBlock = false ∧ signed = true := by
  unfold signoffStatus
  by_cases hc : covBlock = true
  · rw [ite_eq_left hc]
    constructor
    · intro h
      cases h
    · intro h
      have htf : (true : Bool) = false := hc.symm.trans h.2.1
      cases htf
  · have hcf : covBlock = false := by
      cases covBlock with
      | false => rfl
      | true => exact absurd rfl hc
    rw [ite_eq_right hc]
    by_cases hall :
        prior.all (fun g => decide (g = GateStatus.complete)) = true
    · rw [ite_eq_left hall]
      by_cases hs : signed = true
      · rw [ite_eq_left hs]
        constructor
        · intro _
          refine ⟨?_, hcf, hs⟩
          have hall' := (List.all_eq_true).mp hall
          intro g hg
          exact of_decide_eq_true (hall' g hg)
        · intro _
          rfl
      · rw [ite_eq_right hs]
        constructor
        · intro h
          cases h
        · intro h
          exact absurd h.2.2 hs
    · rw [ite_eq_right hall]
      by_cases hs : signed = true
      · rw [ite_eq_left hs]
        constructor
        · intro h
          cases h
        · intro h
          exfalso
          apply hall
          rw [List.all_eq_true]
          intro g hg
          rw [decide_eq_true_eq]
          exact h.1 g hg
      · rw [ite_eq_right hs]
        constructor
        · intro h
          cases h
        · intro h
          exact absurd h.2.2 hs

theorem signoffStatus_complete_prior {prior : List GateStatus}
    {covBlock signed : Bool}
    (h : signoffStatus prior covBlock signed = .complete) :
    ∀ g ∈ prior, g = .complete :=
  (signoffStatus_complete_iff.mp h).1

theorem and_eq_true_iff {a b : Bool} :
    (a && b) = true ↔ a = true ∧ b = true := by
  cases a <;> cases b <;> simp

/-! ### 2.2 `signoff_ready` (workflow.ts ll. 354–357) -/

/-- The report-level `signoff_ready` flag: all prior gates complete,
    the sign-off gate not blocked, and no covenant block. Note it does
    **not** require a signature — "ready" is weaker than "complete"
    (see `signoff_ready_without_signature`). -/
def signoffReady (prior : List GateStatus) (signoff : GateStatus)
    (covBlock : Bool) : Bool :=
  prior.all (fun g => decide (g = GateStatus.complete)) &&
    decide (signoff ≠ GateStatus.blocked) && !covBlock

theorem signoffReady_prior_complete {prior : List GateStatus}
    {signoff : GateStatus} {covBlock : Bool}
    (h : signoffReady prior signoff covBlock = true) :
    ∀ g ∈ prior, g = .complete := by
  have h1 : prior.all (fun g => decide (g = GateStatus.complete)) = true :=
    (and_eq_true_iff.mp (and_eq_true_iff.mp h).1).1
  have hall := (List.all_eq_true).mp h1
  intro g hg
  exact of_decide_eq_true (hall g hg)

/-- A completed sign-off implies the report flags `signoff_ready`. -/
theorem signoff_complete_ready {prior : List GateStatus}
    {covBlock signed : Bool}
    (h : signoffStatus prior covBlock signed = .complete) :
    signoffReady prior (signoffStatus prior covBlock signed)
      covBlock = true := by
  obtain ⟨hall, hcb, -⟩ := signoffStatus_complete_iff.mp h
  have ha : prior.all (fun g => decide (g = GateStatus.complete)) =
      true := by
    rw [List.all_eq_true]
    intro g hg
    rw [decide_eq_true_eq]
    exact hall g hg
  have hb : decide (GateStatus.complete ≠ GateStatus.blocked) =
      true := rfl
  have hc2 : (!covBlock) = true := by simp [hcb]
  unfold signoffReady
  rw [h, ha, hb, hc2]
  rfl

/-- …but `signoff_ready` can hold with **no signature at all**: prior
    gates complete and unsigned ⇒ sign-off gate is `in_progress` while
    the report already says `signoff_ready = true`. (By design — the
    flag means "ready to sign" — but it must not be read as "signed".) -/
theorem signoff_ready_without_signature :
    signoffStatus [GateStatus.complete] false false = .inProgress ∧
      signoffReady [GateStatus.complete]
        (signoffStatus [GateStatus.complete] false false) false =
        true := by
  decide

/-! ### 2.3 Source freeze (`freezeGate`, workflow.ts ll. 60–93) -/

/-- The `freeze_at` input: absent, present-but-unparseable, or a valid
    timestamp (integer ms). The code distinguishes all three
    (l. 61 vs l. 71). -/
inductive FreezeInput where
  | notSet
  | invalid
  | at (t : Int)
  deriving DecidableEq, Repr

/-- An extract counts against the freeze if its timestamp is
    unparseable (`null`) or strictly after the freeze (l. 79). -/
def freezeLate (f : Int) (s : Option Int) : Bool :=
  match s with
  | none => true
  | some ms => decide (f < ms)

def freezeStatus (fi : FreezeInput) (srcs : List (Option Int)) :
    GateStatus :=
  match fi with
  | .notSet =>
      match srcs with
      | [] => .notStarted
      | _ => .inProgress
  | .invalid => .blocked
  | .at f =>
      match srcs with
      | [] => .blocked
      | _ :: _ =>
          if srcs.any (freezeLate f) = true then .blocked else .complete

theorem freezeStatus_invalid (srcs : List (Option Int)) :
    freezeStatus .invalid srcs = .blocked := rfl

/-- **Freeze completes iff** a valid freeze timestamp exists, at least
    one extract was supplied, and every extract is parseable and taken
    at or before the freeze. -/
theorem freezeStatus_complete_iff {f : Int} {srcs : List (Option Int)} :
    freezeStatus (.at f) srcs = .complete ↔
      srcs ≠ [] ∧ ∀ s ∈ srcs, ∃ ms, s = some ms ∧ ms ≤ f := by
  constructor
  · intro h
    cases srcs with
    | nil =>
        exfalso
        have hb : freezeStatus (.at f) [] = .blocked := rfl
        rw [hb] at h
        cases h
    | cons a rest =>
        refine ⟨by simp, ?_⟩
        have hany : (a :: rest).any (freezeLate f) = false := by
          cases h2 : (a :: rest).any (freezeLate f) with
          | false => rfl
          | true =>
              exfalso
              have hb : freezeStatus (.at f) (a :: rest) = .blocked := by
                simp [freezeStatus, h2]
              rw [hb] at h
              cases h
        have hall := (List.any_eq_false).mp hany
        intro s hs
        have hns := hall s hs
        cases s with
        | none =>
            have hlate : freezeLate f none = true := rfl
            exact absurd hlate hns
        | some ms =>
            refine ⟨ms, rfl, ?_⟩
            have hdec : decide (f < ms) = false := by
              have hlate : freezeLate f (some ms) = decide (f < ms) := rfl
              cases hd : decide (f < ms) with
              | false => rfl
              | true =>
                  rw [hlate, hd] at hns
                  exact absurd rfl hns
            have hnlt : ¬ (f < ms) := by
              intro hlt
              have ht : decide (f < ms) = true := by
                rw [decide_eq_true_eq]
                exact hlt
              rw [ht] at hdec
              cases hdec
            exact Int.not_lt.mp hnlt
  · intro h
    cases srcs with
    | nil => exact absurd rfl h.1
    | cons a rest =>
        have hany : (a :: rest).any (freezeLate f) = false := by
          rw [List.any_eq_false]
          intro s hs hlate
          obtain ⟨ms, rfl, hle⟩ := h.2 s hs
          have hlt : f < ms := of_decide_eq_true hlate
          exact (Int.not_lt.mpr hle) hlt
        simp [freezeStatus, hany]

/-! ### 2.4 Subledger cutoffs (`cutoffGate`, workflow.ts ll. 95–136) -/

/-- The cutoff gate, abstracted to the required (system, subledger)
    pairs: each pair is missing (`none`), present-but-unfrozen
    (`some false`), or frozen (`some true`); `noInput` is the JS
    condition `systems.length === 0 && cutoffs.length === 0`.
    (The JS `blocked`-vs-`in_progress` choice also consults frozen
    rows for *non-required* pairs; that affects only the
    blocked/in-progress distinction, never `complete` — see NOTES.) -/
def cutoffStatus (noInput : Bool) (pairs : List (Option Bool)) :
    GateStatus :=
  if noInput = true then .notStarted
  else if pairs.all (fun p => decide (p = some true)) = true then .complete
  else if pairs.any (fun p => decide (p = some true)) = true then .blocked
  else .inProgress

/-- **Cutoffs complete iff** some input was supplied and every required
    pair has a frozen row. Note the vacuous case: with input present
    but *zero* required pairs, the gate completes ("Required subledgers
    frozen for 0 system(s)") — the iff's right side is then vacuous. -/
theorem cutoffStatus_complete_iff {noInput : Bool}
    {pairs : List (Option Bool)} :
    cutoffStatus noInput pairs = .complete ↔
      noInput = false ∧ ∀ p ∈ pairs, p = some true := by
  unfold cutoffStatus
  by_cases hn : noInput = true
  · rw [ite_eq_left hn]
    constructor
    · intro h
      cases h
    · intro h
      have htf : (true : Bool) = false := hn.symm.trans h.1
      cases htf
  · have hnf : noInput = false := by
      cases noInput with
      | false => rfl
      | true => exact absurd rfl hn
    rw [ite_eq_right hn]
    by_cases hall : pairs.all (fun p => decide (p = some true)) = true
    · rw [ite_eq_left hall]
      constructor
      · intro _
        refine ⟨hnf, ?_⟩
        have hall' := (List.all_eq_true).mp hall
        intro p hp
        exact of_decide_eq_true (hall' p hp)
      · intro _
        rfl
    · rw [ite_eq_right hall]
      by_cases hany : pairs.any (fun p => decide (p = some true)) = true
      · rw [ite_eq_left hany]
        constructor
        · intro h
          cases h
        · intro h
          exfalso
          apply hall
          rw [List.all_eq_true]
          intro p hp
          rw [decide_eq_true_eq]
          exact h.2 p hp
      · rw [ite_eq_right hany]
        constructor
        · intro h
          cases h
        · intro h
          exfalso
          apply hall
          rw [List.all_eq_true]
          intro p hp
          rw [decide_eq_true_eq]
          exact h.2 p hp

/-! ### 2.5 Reconciliation queue (`recGate`, workflow.ts ll. 138–165) -/

/-- The reconciliation gate over aggregate counts. `covOk` abstracts
    the float test `covered / total >= cfg.min_reconciliation_coverage`
    (under the default config the threshold is `1`, i.e. `covOk` holds
    iff `covered = total` for `total > 0` — see NOTES for the float
    caveat). `open` is the number of items with status `"open"`; the
    empty-queue case is `hasItems = false`. -/
def recStatus (hasItems covOk requireCleared : Bool) (openCount : Nat) :
    GateStatus :=
  if hasItems = false then .notStarted
  else if covOk = true ∧ (requireCleared = false ∨ openCount = 0) then .complete
  else if 0 < openCount then .blocked
  else .inProgress

/-- Under the default `require_recs_cleared = true`, a complete
    reconciliation gate means **zero open items** (and coverage met). -/
theorem recStatus_complete_defaults {hasItems covOk : Bool} {openCount : Nat}
    (h : recStatus hasItems covOk true openCount = .complete) :
    openCount = 0 ∧ covOk = true := by
  unfold recStatus at h
  by_cases hh : hasItems = false
  · rw [ite_eq_left hh] at h
    cases h
  · rw [ite_eq_right hh] at h
    by_cases hcond : covOk = true ∧ ((true : Bool) = false ∨ openCount = 0)
    · rw [ite_eq_left hcond] at h
      rcases hcond with ⟨hcov, hf | h0⟩
      · cases hf
      · exact ⟨h0, hcov⟩
    · rw [ite_eq_right hcond] at h
      by_cases ho : 0 < openCount
      · rw [ite_eq_left ho] at h
        cases h
      · rw [ite_eq_right ho] at h
        cases h

/-! ### 2.6 Evidence bundle (`evidenceGate`, workflow.ts ll. 167–188) -/

/-- The evidence gate over the *assembled* bundle (the caller passes
    `assembleEvidence`'s output, workflow.ts ll. 264–320, 347): empty bundle ⇒
    not_started; all required kinds present ⇒ complete; otherwise
    blocked. -/
def evidenceStatus (kinds required : List String) : GateStatus :=
  if kinds.isEmpty = true then .notStarted
  else if required.all (fun k => decide (k ∈ kinds)) = true then .complete
  else .blocked

/-- **Evidence completes only if** the bundle is nonempty and every
    required kind is present. (Which artifacts count is decided by
    `assembleEvidence`, which *generates* several kinds itself — see
    NOTES.) -/
theorem evidenceStatus_complete {kinds required : List String}
    (h : evidenceStatus kinds required = .complete) :
    kinds ≠ [] ∧ ∀ k ∈ required, k ∈ kinds := by
  unfold evidenceStatus at h
  by_cases he : kinds.isEmpty = true
  · rw [ite_eq_left he] at h
    cases h
  · rw [ite_eq_right he] at h
    by_cases hall : required.all (fun k => decide (k ∈ kinds)) = true
    · rw [ite_eq_left hall] at h
      refine ⟨?_, ?_⟩
      · intro hnil
        rw [hnil] at he
        simp at he
      · have hall' := (List.all_eq_true).mp hall
        intro k hk
        exact of_decide_eq_true (hall' k hk)
    · rw [ite_eq_right hall] at h
      cases h

/-! ### 2.7 Exception SLA (`slaGate`, workflow.ts ll. 190–230) -/

/-- The SLA gate over aggregate counts: `supplied` = any invoices or
    exceptions were given; `nowOk` = `input.now` parses; `open` = open
    exceptions; `past` = open exceptions with `now > opened_at + sla`
    (an open exception whose `opened_at` is unparseable is never past
    — l. 207 — so it can keep this gate `in_progress` forever;
    see NOTES). -/
def slaStatus (supplied nowOk : Bool) (openCount past : Nat) : GateStatus :=
  if supplied = false then .notStarted
  else if nowOk = false then .blocked
  else if openCount = 0 then .complete
  else if 0 < past then .blocked
  else .inProgress

/-- **SLA completes only if** something was supplied, `now` parsed,
    and there are no open exceptions at all. -/
theorem slaStatus_complete {supplied nowOk : Bool} {openCount past : Nat}
    (h : slaStatus supplied nowOk openCount past = .complete) :
    supplied = true ∧ nowOk = true ∧ openCount = 0 := by
  unfold slaStatus at h
  by_cases hs : supplied = false
  · rw [ite_eq_left hs] at h
    cases h
  · rw [ite_eq_right hs] at h
    have hst : supplied = true := by
      cases supplied with
      | true => rfl
      | false => exact absurd rfl hs
    by_cases hn : nowOk = false
    · rw [ite_eq_left hn] at h
      cases h
    · rw [ite_eq_right hn] at h
      have hnt : nowOk = true := by
        cases nowOk with
        | true => rfl
        | false => exact absurd rfl hn
      by_cases ho : openCount = 0
      · rw [ite_eq_left ho] at h
        exact ⟨hst, hnt, ho⟩
      · rw [ite_eq_right ho] at h
        by_cases hp : 0 < past
        · rw [ite_eq_left hp] at h
          cases h
        · rw [ite_eq_right hp] at h
          cases h

/-! ### 2.8 Assembly (`runFiveDayClose`, workflow.ts ll. 337–371) -/

/-- The report's gate list: the five prior gates in `CLOSE_GATES`
    order, followed by the sign-off gate computed from them
    (ll. 344–350). -/
def gateList (s1 s2 s3 s4 s5 : GateStatus) (covBlock signed : Bool) :
    List GateStatus :=
  [s1, s2, s3, s4, s5, signoffStatus [s1, s2, s3, s4, s5] covBlock signed]

/-- **No closing with prerequisites incomplete**: if the last gate of
    the assembled list (controller sign-off) is `complete`, then every
    one of the five prior gates — source freeze, subledger cutoffs,
    reconciliation queue, evidence bundle, exception SLA — is
    `complete`. -/
theorem no_close_with_incomplete_prereqs {s1 s2 s3 s4 s5 : GateStatus}
    {covBlock signed : Bool}
    (h : signoffStatus [s1, s2, s3, s4, s5] covBlock signed = .complete) :
    s1 = .complete ∧ s2 = .complete ∧ s3 = .complete ∧
      s4 = .complete ∧ s5 = .complete := by
  have hall := (signoffStatus_complete_iff.mp h).1
  refine ⟨hall s1 ?_, hall s2 ?_, hall s3 ?_, hall s4 ?_, hall s5 ?_⟩ <;>
    simp

end FinanceEngines
