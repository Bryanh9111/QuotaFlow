# Debate Synthesis: QuotaFlow MVP Plan Review

**Date:** 2026-04-03
**Participants:** Claude/Opus (Realist), Sonnet (Pragmatist), Gemini (Architect), Codex (Devil's Advocate)

---

## Consensus Points (All 4 Agree)

### 1. Feature Branch Isolation Is the Best Decision
Every debater independently identified this as the strongest part of the plan. The "commit to feature branch, never push, never touch main" policy is the safety net that makes the entire concept viable.

### 2. Token Estimation Is the Biggest Risk
All 4 agree: the quota model is the plan's Achilles heel. QuotaFlow only tracks its own usage, has no visibility into manual sessions, and the char-to-token fallback (`stdout.length / 4`) is unreliable. The 10% safety buffer is necessary but insufficient.

### 3. launchd plist Hardcodes nvm Path
All participants flagged this as a reliability issue. A Node version upgrade silently breaks the daemon.

---

## Key Disagreements

### Should the Task Queue Be JSON or SQLite?
| Position | Debater |
|----------|---------|
| JSON is fine for MVP, migrate in Phase 2 | Sonnet, Opus |
| Must be SQLite from day one (ACID guarantee) | Gemini |
| JSON is proof this isn't real software | Codex |

**Verdict:** Keep JSON for MVP but add a startup recovery check for corrupted files. The PRD explicitly scopes Phase 2 for SQLite migration. The risk of data loss during a `writeFileSync` crash is real but low for a personal daemon writing small files.

### Should v1 Be a Daemon or a Batch Runner?
| Position | Debater |
|----------|---------|
| Daemon is correct | Sonnet, Opus, Gemini |
| Batch runner is safer and more honest | Codex |

**Verdict:** Daemon is correct. The value proposition requires checking multiple times per 5-hour window. A single batch run can't adapt to mid-window quota changes. However, Codex's point about idempotency is valid -- the daemon must handle restart/crash recovery gracefully.

### Proxy Wrapper vs. Process Detection?
| Position | Debater |
|----------|---------|
| pgrep is fine for MVP | Sonnet, Opus |
| Should be a CLI proxy from the start | Gemini |
| Process detection is fundamentally broken | Codex |

**Verdict:** pgrep for MVP, proxy for Phase 2. The proxy idea (alias `claude` to `quotaflow exec`) is architecturally elegant and solves both activity detection and token tracking in one shot. But it's too invasive for v1 -- intercepting the user's CLI changes their workflow.

---

## Action Items for Plan Update

### Must Fix Before Implementation (P0)

1. **Wire `registerOwnPid()`** - Codex caught that the executor spawns Claude processes but never registers their PIDs with ActivityDetector. Without this, QuotaFlow detects its own sessions as "user active" and stops dispatching.

2. **Git cleanliness check** - Before `git checkout -b`, verify `git status --porcelain` is clean. If dirty, skip the task and log a warning. (Gemini, Opus, Codex all flagged this)

3. **Crash recovery for `running` tasks** - On startup, scan for tasks with `status: "running"` and reset them to `queued`. Also check for orphaned `quotaflow/*` branches in target projects. (Gemini, Codex)

4. **Fix launchd plist** - Use a wrapper script that sources nvm instead of hardcoding the Node path. (All 4)

5. **Add CLAUDE.md** - the user explicitly requested this. (Opus)

### Should Fix (P1)

6. **Drop `safe` field from MVP schema** - It exists but nothing reads it. Either implement it or remove it to avoid false confidence. (Sonnet, Codex)

7. **Add probe-first strategy** - Before dispatching a large task, run a tiny "probe" to confirm quota is available. Reduces rate-limit risk. (Opus)

8. **Add `--dry-run` flag** - Print what would be dispatched without executing. Essential for debugging. (Opus)

9. **Weekly quota gating in scheduler** - The scheduler checks 5h window but never checks weekly rolling limit. Add `quota.getWeeklyUsage()` check. (Codex)

### Nice to Have (P2)

10. **JSON schema validation with Zod** - Replace hand-rolled validation. (Opus)

11. **Proxy/wrapper CLI for future token tracking** - Design the interface now even if not implemented. (Gemini)

---

## Debate Scores

| Debater | Specificity | Novelty | Actionability | Overall |
|---------|------------|---------|---------------|---------|
| **Codex** | 9/10 | 8/10 | 8/10 | **8.3** |
| **Gemini** | 8/10 | 9/10 | 7/10 | **8.0** |
| **Opus** | 8/10 | 7/10 | 9/10 | **8.0** |
| **Sonnet** | 9/10 | 6/10 | 8/10 | **7.7** |

**Winner: Codex** -- Most rigorous, caught the most implementation gaps (unwired registerOwnPid, unused safe flag, missing crash recovery, no weekly quota gating). The "batch runner" take was the most provocative but least actionable.

**Most Valuable Insight: Gemini's proxy/wrapper idea** -- Solving both activity detection and token tracking by becoming the Claude CLI itself is the highest-leverage architectural improvement for Phase 2.
