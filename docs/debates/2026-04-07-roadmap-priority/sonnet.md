# Roadmap Debate: Pragmatic Engineer Position
**Date**: 2026-04-07
**Role**: Pragmatic Engineer - ship value fast, avoid over-engineering
**Model**: claude-sonnet-4-6

---

## The Actual Problem First

Before I take positions, let me name what's really happening: Henry has 8 projects, one of them (Athena) is a glutton, and by mid-week the weekly quota is 68% gone. The daemon is working. The problem is fairness and visibility, not architecture.

Everything else on this list should be evaluated against that lens.

---

## Top 3 to Do THIS WEEK

### 1. Execution History DB (item #2)

This is the force multiplier for everything else. Right now `usage_log` stores `task_id`, `tokens_used`, `duration_ms`, `recorded_at`, and `task_size` - but there is no `project` column. That single missing column is why we cannot answer "how much did Athena eat this week?" without joining against the task queue JSON, which is mutable and lossy (completed tasks stay, but we lose context over time).

Add `project TEXT` to `usage_log`. That is one migration line and one extra field in `recordUsage()`. With that in place, per-project breakdown in the digest becomes a single GROUP BY query. The trend analysis, the per-project budget enforcement, the GC scan - all of them become trivially implementable. Without it, every other feature is building on sand.

Cost: 2 hours. Risk: none. Payoff: unlocks items 4, 6, and 11 for free.

### 2. Per-Project Token Budget % (item #6)

Yes, this is the right priority - but only *after* we have project-tagged history (item #2). The "simpler way" people usually suggest is round-robin scheduling. Don't do it. Round-robin ignores priority and task size; it will delay a high-priority Relay task because Athena already ran once this cycle. That is worse behavior than what we have now.

The right solution is a weekly budget cap per project in `config.json`: `"Athena": 0.25` means Athena gets at most 25% of weekly quota. The scheduler checks `getWeeklyUsageByProject(project)` before dispatching. If Athena is over its cap, `pickNextExcluding` skips it. This is a 30-line change to `scheduler.ts` and `quota.ts` once the DB column exists.

This directly solves Henry's pain. Ship it this week.

### 3. Enhanced Daily Digest (item #4)

The current `sendDailyDigest` in `notify.ts` sends three numbers: completed count, failed count, quota utilization. That is nearly useless for diagnosing the Athena problem. Henry is checking Discord and seeing "68%" with no idea which project burned it.

Add per-project breakdown to the embed: a field per project showing tasks run and tokens consumed that week. This is pure presentation work on top of the DB query that item #2 enables. Cost: 3 hours. This closes the feedback loop - Henry will see the problem in his notifications instead of discovering it when it is too late.

---

## Top 3 for Near-Term Roadmap (Next 2 Weeks)

### 4. AGENTS.md (item #3)

Once the daemon is running real tasks across 8 projects, the agents doing the work need orientation. A 100-line markdown file per project telling the agent: what this project does, which directories to touch, what not to touch, coding conventions. This is not optional for quality output - it is the difference between Claude making sensible PRs and Claude cargo-culting patterns from the wrong module.

Low effort, high leverage on output quality. Week 2.

### 5. Architecture Boundary Tests (item #10)

We have 133 tests but I can see from the code that `Scheduler` takes injected deps, `QuotaMonitor` is standalone, `TaskQueueManager` reads/writes JSON directly. The architecture is clean. What we do not have is tests that enforce the boundaries: nothing ensures that `executor.ts` does not import from `quota.ts` directly, or that CLI commands do not bypass the queue. These tests are cheap to write with a static import graph check and they prevent the codebase from rotting as features get added. Week 2, before the dashboard lands.

### 6. Weekly GC Scan (item #11)

Once Athena is budget-capped and the digest shows per-project data, the natural next question is "what tasks are stale?" A weekly scan that flags tasks sitting in `queued` for more than N days and pings Discord is a cron job on top of existing infrastructure. It closes the loop on task hygiene without requiring a dashboard. Week 2.

---

## Items to DROP Entirely

### Agent Adapter Pattern (item #1)

This is pure speculation. There is one CLI: `claude`. There is no second CLI imminent. Writing an adapter layer now means writing an abstraction with exactly one implementation, which means we are writing dead code dressed up as "future-proofing." When a second CLI actually exists and we actually need to support it, the refactor will take 4 hours. Building the abstraction now will take 4 hours and add ongoing cognitive overhead. YAGNI. Drop it.

### Web Dashboard (item #5)

This is the classic "wouldn't it be nice" feature that adds a React frontend, a local HTTP server, a build step, and a deployment concern to a daemon that currently has zero runtime dependencies beyond SQLite and better-sqlite3. The existing Discord digest is the dashboard. If the digest is improved (item #4), this is redundant for 90% of use cases. The 10% case where you want to drag-and-drop task priority is not worth the maintenance surface. Drop it. Revisit if Henry explicitly says "I need a UI."

### Task Dependencies (item #7)

There is one real task in history. We do not know if dependencies are a real pain yet. Building a `depends_on` graph resolver into the queue before we have even seen two tasks that need to be sequenced is premature. The current priority+size gating already handles most sequencing implicitly. Drop it until someone actually says "I needed task B to wait for task A."

### Client-Server Architecture (item #8)

Absolutely not. This is a local daemon on a single Mac. The moment you split into client-server you get network code, authentication, service discovery, and failure modes that do not exist today. If multi-machine is ever needed, the right move is to run one daemon per machine and share a task queue via a file on a network share or a simple SQLite in iCloud Drive. Drop it permanently.

### Sub-Agent Orchestration (item #9)

Auto-decomposing tasks sounds powerful. It is also a research project. The decomposition quality depends entirely on the prompt and the model, there is no reliable way to test it, and failure modes are unpredictable. The daemon's job is to be a reliable scheduler, not an AI planner. Keep execution atomic and human-authored. Drop it.

---

## Missing Items Not on the List

### Per-Run Cost Logging to Discord

Right now `taskCompleted` in `notify.ts` posts tokens and duration but not cost. Henry is a Claude Max 5x subscriber - actual dollar cost is not directly visible, but relative cost (tokens vs. project budget cap) is. The notification should say "Athena: 47k tokens (83% of weekly cap)" not just "47000." This is a one-line change that makes the problem visible in real time, not just in digests.

### Task Age / Staleness in `list` Command

The CLI `list` command currently shows status and description. It does not show how long a task has been sitting in `queued`. A task queued for 6 days is almost certainly stale or the project's quota cap is preventing it. Surface `created_at` age in the list output so Henry can identify and cull stale work without waiting for the GC scan.

### Quota Reserve for Manual Use

The scheduler already stops at 90% weekly. But there is no way to set this threshold per-session. Some weeks Henry might want to run manual tasks heavily; other weeks he wants the daemon to run freely. A `--reserve-pct` flag or a config field `manual_reserve_percent` would let him tune this without editing source code.

---

## On Question 5: Is Per-Project Budget Really the Right Priority?

Yes - but the framing matters. "Per-project budget" sounds like a complex feature. It is actually just: add a map to config, one query to check it, one branch in the scheduler. The real prerequisite is the DB project column (item #2). The right way to sequence this is:

1. Add `project` column to `usage_log` (30 minutes)
2. Add `getWeeklyUsageByProject()` to `QuotaMonitor` (20 minutes)
3. Add `project_budgets` to config schema (10 minutes)
4. Add cap check in `doTick()` before dispatch (30 minutes)
5. Show per-project usage in daily digest (1 hour)

Total: half a day. This is not a "feature" - it is a configuration knob backed by a query. The reason to do it this week is that Henry's quota problem is active right now, and every week without it is another week where Athena can go unchecked.

The simpler alternative - just manually lower Athena's task priority to `low` - is not simpler. It requires Henry to remember to do it, it does not adapt to actual consumption, and it punishes Athena globally instead of enforcing a weekly cap. The budget cap is the right solution and it is not expensive to build.

---

## Summary Ranking

| Item | Verdict | When |
|------|---------|------|
| #2 Execution history DB (add project column) | DO IT | Day 1 this week |
| #6 Per-project budget cap | DO IT | Day 2-3 this week |
| #4 Enhanced daily digest | DO IT | Day 4 this week |
| #3 AGENTS.md | DO IT | Week 2 |
| #10 Architecture boundary tests | DO IT | Week 2 |
| #11 Weekly GC scan | DO IT | Week 2 |
| #1 Agent adapter pattern | DROP | Never (YAGNI) |
| #5 Web dashboard | DROP | Only if Henry explicitly asks |
| #7 Task dependencies | DROP | Only if a real case emerges |
| #8 Client-server architecture | DROP | Never |
| #9 Sub-agent orchestration | DROP | Research project, not a feature |
