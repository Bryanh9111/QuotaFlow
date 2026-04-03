# Claude/Opus - The Realist

## 1. PRD Requirements Not Yet Implemented

**Story 1 AC: "safe flag"** - PRD line 64 mentions a `safe` field. Deliberately removed per debate P1 decision. Not a gap -- documented design choice.

**Story 5 AC: "Weekly summary report: utilization rate, task completion rate, per-project breakdown"** - The weekly digest currently calls the same `sendDailyDigest` method (scheduler.ts:184). It sends the same format as the daily report, not a distinct weekly report with per-project breakdown and utilization rates. This is a minor gap -- the weekly report should have richer content.

**Story 6 AC: "Total concurrent sessions (manual + auto) respect subscription limits"** - Not implemented. The scheduler tracks its own activeProjects but doesn't account for manual claude sessions when counting concurrent slots. Activity detector pauses dispatch when user is active, but if max_concurrency=2, both auto slots could run while the user has their own session -- potentially 3 total.

**Story 4 AC: "Adjusts estimates based on rate limit responses"** - Partially implemented. Rate limit marks the window as exhausted (binary), but doesn't use the rate limit event to recalibrate the token estimate for future windows. The system doesn't learn from rate limits.

## 2. Bugs or Issues

**cli.ts:143 - runStatus displayTotal calculation is wrong.** It does `available + weekly_tokens` which mixes window-level available tokens with 7-day cumulative usage. If you've used 200K tokens this week across many windows but currently have 79K available, it shows "79,000 / 279,000" -- meaningless. Should show `available / window_capacity` (i.e., available / floor(88000 * 0.9)).

**scheduler.ts:88 - weeklyLimitTokens estimation is dubious.** `config.quota.weekly_compute_hours * 3600 * 10` assumes 10 tokens/sec compute rate. This is a rough guess that could be wildly off. If it's too low, tasks won't dispatch even with ample quota. Should be configurable or documented as approximate.

**activity.ts:51 - lastActiveTime never set when processes found.** When `isUserActive()` detects external processes and returns true, it doesn't update `lastActiveTime`. This means the grace period timer only works if an external caller explicitly calls `setLastActiveTime()`. In practice, this means the threshold feature is broken -- once processes disappear, the daemon immediately starts dispatching (no grace period) because `lastActiveTime` is null.

**scheduler.ts:60 - checkDigests() in finally block can throw.** If Discord webhook fails or quota.getWeeklyUsage() throws, the error propagates through the finally block. This would prevent `this.busy = false` from being set... wait, no -- the finally block sets busy after checkDigests. Actually the order is: `await this.checkDigests()` then `this.busy = false`. If checkDigests throws, busy stays true and the daemon locks up permanently. Should be wrapped in try/catch.

## 3. Real-World Usage Blockers

**Critical: checkDigests crash locks the daemon.** The bug above (scheduler.ts:60) means any Discord webhook timeout or network error in checkDigests will permanently freeze the scheduler. The busy flag never resets. This must be fixed before real use.

**Medium: No ~/.quotaflow directory bootstrapping from CLI.** Running `npx tsx src/index.ts add "task" --project Relay` before the daemon has ever started will fail because `~/.quotaflow/` might not exist and the queue manager tries to write to `~/.quotaflow/tasks.json`. The daemon creates the directory in `main()`, but CLI commands execute before that path.

**Low: No validation that `--project` value matches an actual project name.** The queue validates the path exists, but if the user types `--project relay` (lowercase) instead of `--project Relay`, addTask will throw "Project path does not exist" with no suggestion of valid names.
