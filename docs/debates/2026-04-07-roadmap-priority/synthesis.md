# Debate Synthesis: QuotaFlow Roadmap Priority

**Date:** 2026-04-07
**Participants:** Opus (Realist), Sonnet (Pragmatist), Gemini (Architect), Codex (Devil's Advocate)

---

## The Biggest Finding: Two Debaters Independently Said "Don't Build Per-Project Budget"

Both **Opus** and **Codex** argued against #6 per-project budget, which was Sonnet's top priority. Their reasoning converged on the same insight:

> **The 908K token task falsified the sizing model.** `SIZE_TOKEN_ESTIMATES.large = 60000` was off by 15x. Before adding policy (budgets), we need accurate units. Budgets on top of bad sizing is "false precision" (Codex) or "building on sand" (Sonnet's own words, applied differently).

Codex went further: **"budgets substitute fairness theater for value"** — they invite gaming, create arbitrary envelopes, and punish high-value work. If Athena is the highest-value project, it SHOULD be allowed to consume most of the week. The fix is stricter task scoping + kill switches, not percentages.

---

## Strong Consensus: DO THIS WEEK (3-4/4)

### #2 Execution History DB (Unanimous 4/4)

All four debaters put this first. Sonnet's finding is the critical action item:

> **`usage_log` table already exists but LACKS a `project` column.** One ALTER TABLE unlocks per-project analysis, digest breakdowns, and future budget logic.

Codex qualifies: "as minimal instrumentation, not a new subsystem." Opus emphasizes: "this enables calibration, not just reporting."

**Implementation: 30 minutes**
- `ALTER TABLE usage_log ADD COLUMN project TEXT`
- Update `recordUsage()` signature to accept project
- Update scheduler to pass `task.project` when recording

### #4 Enhanced Daily Digest (Unanimous 4/4)

Current digest shows 3 numbers (completed/failed/utilization). All four agree it's nearly useless for diagnosing the Athena problem. With #2 in place, per-project breakdown is a GROUP BY query.

**Implementation: 1 hour**
- Query usage by project for the week
- Format as Discord embed fields
- Show: tokens, % of weekly total, task count, success rate per project

### #3 AGENTS.md (Codex's #1, Sonnet week 2, Opus drops, Gemini drops)

**Codex's reasoning is the key insight here:** *"The immediate problem smells like prompt/task discipline, not missing software. You need hard constraints: mandatory decomposition, explicit stop conditions, capped plan depth, smaller deliverables."*

This reframes AGENTS.md from "nice documentation" to **"scope control mechanism."** If every task description that goes to claude -p gets prepended with "decompose into <20k token steps, stop at first deliverable", the 908K outlier problem gets solved at the prompt layer.

**Implementation: 1-2 hours** — Write per-project AGENTS.md with hard scoping rules injected into every task prompt.

---

## Strong Consensus: DROP ENTIRELY (3-4/4)

| Item | Opus | Sonnet | Gemini | Codex | Verdict |
|------|------|--------|--------|-------|---------|
| #5 Web Dashboard | Drop | Drop | Drop | Drop | **4/4 DROP** |
| #8 Client-Server | Drop | Drop | Drop | Drop | **4/4 DROP** |
| #9 Sub-Agent | Drop | Drop | Keep (DAG) | Drop (DANGEROUS) | **3/4 DROP** |
| #7 Task Dependencies | Drop | Drop | Keep | Drop | **3/4 DROP** |

**Codex's warning on #9:** "Sub-agents are actively dangerous when your only real datapoint is a 908k-token planning run; that is how you multiply burn rate and coordination noise."

---

## Key Disagreement: Per-Project Budget

| Debater | Position |
|---------|----------|
| **Sonnet** | DO IT — 30-line change, solves Athena problem directly |
| **Gemini** | Reframe as Weighted Fair Queuing (dynamic allocation) |
| **Opus** | Do it AFTER calibration data — 2 weeks of measurement first |
| **Codex** | DROP — "fairness theater", invites gaming, budgets on broken units |

**Synthesis verdict:** Deferred. Codex's critique is strongest — we have no reliable sizing to build budgets on. Instead, solve the root cause: **task scope control via AGENTS.md + task kill switch**.

---

## Missing Items Added

**Opus:**
- Add `xlarge` task size tier (500K-1M tokens)
- Mid-execution token kill switch (kill task if exceeds per-task budget)
- Real-time token consumption logging during execution

**Sonnet:**
- Task age in `list` command output
- `--reserve-pct` flag for manual quota reservation

**Codex:**
- **Task scope controls in prompt prefix** (mandatory decomposition, stop conditions, capped depth) — this is the real fix

**Gemini:**
- Cost projection / dry-run simulation
- Backpressure signals when queue is saturated

---

## Final Prioritized Action Plan

### This Week (~3 hours, addresses root cause)

1. **Add `project` column to `usage_log`** (30 min) — Sonnet unanimously supported
2. **Fix estimator to learn from history** (30 min) — `recordUsage` must include `task_size` so `estimateTokens` can actually calibrate. Currently it stores size but the self-recording path doesn't use it correctly (Codex found this bug)
3. **Enhanced digest with per-project breakdown + outlier detection** (1 hour) — show "Athena: 908K tokens (94% of week)" and flag estimate vs actual mismatches
4. **AGENTS.md as task scope control** (1 hour) — write prompt prefix that forces decomposition, stop conditions, smaller deliverables. Inject into every `claude -p` invocation.
5. **Add `xlarge` task size tier** (15 min) — real data shows 60K `large` is wrong for planning tasks

### Week 2 (only if needed after measuring)

- Per-task kill switch (kill if >X tokens consumed mid-run) — Opus's insight
- Task age/staleness in CLI list — Sonnet
- Weekly GC scan — low priority, 31 tasks total

### Dropped Permanently

- Web dashboard (4/4)
- Client-server architecture (4/4)
- Sub-agent orchestration (3/4, Codex warning: dangerous)
- Task dependencies (3/4, YAGNI)
- Per-project budget (deferred indefinitely per Codex critique)

### Roadmap (trigger-based)

- Agent adapter (when 2nd CLI exists)
- Architecture boundary tests (when codebase > 30 files)

---

## Debate Scores

| Debater | Specificity | Actionability | Insight | Overall |
|---------|------------|---------------|---------|---------|
| **Codex** | 10/10 | 9/10 | 10/10 | **9.7** |
| **Sonnet** | 10/10 | 10/10 | 7/10 | **9.0** |
| **Opus** | 8/10 | 7/10 | 9/10 | **8.0** |
| **Gemini** | 7/10 | 7/10 | 8/10 | **7.3** |

**Winner: Codex** — Read source code with file:line references, exposed the fundamental measurement problem, killed per-project budget with the sharpest argument ("fairness theater"), reframed AGENTS.md as scope control rather than documentation.

**Most valuable reframe: Codex** — "The immediate problem smells like prompt/task discipline, not missing software." This is the insight that changes everything: we don't need more features, we need stricter task scoping.

**Best implementation detail: Sonnet** — Found the missing `project` column in `usage_log` with file:line reference. Without that discovery, half the debate's recommendations would be unimplementable.

**Most provocative: Opus + Codex together** — Both independently argued we haven't earned the right to add features yet. We have ONE data point. Measure before you build.
