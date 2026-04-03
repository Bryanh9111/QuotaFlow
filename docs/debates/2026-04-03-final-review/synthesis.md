# Final Review Debate Synthesis

**Date:** 2026-04-03
**Participants:** Opus (Realist), Sonnet (Pragmatist), Gemini (Architect)

---

## Critical Issues (Must Fix Before Running)

### 1. checkDigests() crash locks daemon permanently
**Found by:** Opus
**File:** `scheduler.ts:58-62`
**Issue:** `checkDigests()` runs in the finally block before `this.busy = false`. If Discord webhook times out or quota DB throws, busy stays true forever, daemon is frozen.
**Fix:** Wrap checkDigests in try/catch inside the finally block.

### 2. Activity detector doesn't track grace period
**Found by:** Opus, Gemini
**File:** `activity.ts:46-51`
**Issue:** When `isUserActive()` finds external processes, it returns true but never sets `lastActiveTime`. When processes disappear, the threshold grace period doesn't work because `lastActiveTime` is null. Daemon immediately starts dispatching.
**Fix:** Set `this.lastActiveTime = new Date()` when external processes found.

### 3. Executor doesn't register spawned claude child PIDs
**Found by:** Gemini
**File:** `executor.ts` / `scheduler.ts`
**Issue:** `registerOwnPid` registers the daemon's PID, but the claude child processes spawned by executor have different PIDs. `pgrep -fl claude` will detect them as "user activity", causing the daemon to self-block.
**Fix:** After spawning claude, capture child PID and register with activity detector. Or filter by parent PID.

---

## Important Issues (Should Fix)

### 4. runStatus displayTotal is wrong
**Found by:** Opus
**File:** `cli.ts:143`
**Fix:** Show available / floor(88000 * 0.9) instead of available + weekly usage.

### 5. Git branch already exists on crash recovery
**Found by:** Gemini
**File:** `executor.ts:90`
**Fix:** Use `git checkout -B` (force create) or delete existing branch first.

### 6. Weekly digest uses same format as daily
**Found by:** Opus, Gemini
**File:** `scheduler.ts:184`
**Fix:** Create a separate `sendWeeklyDigest` with per-project breakdown.

### 7. CLI doesn't create ~/.quotaflow directory
**Found by:** Opus
**File:** `index.ts`
**Fix:** Move mkdirSync before CLI routing.

---

## Known Limitations (Acceptable for Now)

- `--output-format json` may not exist in Claude CLI; token estimation falls back to length/4. Acceptable because rate-limit detection provides a safety net.
- Batch-parallel concurrency (waits for all tasks) vs slot-filling. Acceptable for MVP -- most tasks are similar size.
- No activity check during long-running tasks. Acceptable because tasks commit to feature branches, no blast radius.
- Weekly quota limit estimation (`hours * 3600 * 10`) is approximate. Documented.
- Hardcoded default projects_root -- user must configure.

---

## Action Items

| # | Issue | Severity | Est. Fix |
|---|-------|----------|----------|
| 1 | checkDigests crash locks daemon | Critical | 2 lines |
| 2 | lastActiveTime not set | Critical | 1 line |
| 3 | Child PIDs not registered | Critical | 5 lines |
| 4 | runStatus displayTotal wrong | Medium | 3 lines |
| 5 | Branch already exists | Medium | 1 line |
| 6 | Weekly vs daily digest | Low | New method |
| 7 | CLI mkdir ~/.quotaflow | Low | 2 lines |
