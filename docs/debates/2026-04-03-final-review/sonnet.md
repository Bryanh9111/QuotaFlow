# QuotaFlow Final Review
**Reviewer**: Claude Sonnet 4.6
**Date**: 2026-04-03

---

## 1. PRD Requirements Not Yet Implemented

### Story 1 (Task Queue) - Mostly done, one gap
- **AC: "safe flag" field** - The `Task` type in `src/types.ts` has no `safe` field. The PRD defines the task schema as `{ id, description, project, priority, size, safe, status, created_at }`. The `safe` flag is specified in the schema definition (Feature 1) and the task schema section. It is absent from the type and ignored everywhere.

### Story 3 (Feature Branch Commits) - One gap
- **AC: "If task fails or produces no changes, branch is cleaned up"** - The no-changes case in `executor.ts` (lines 166-181) returns `success: true` with an empty branch. This is correct behavior operationally (Claude ran, just made no changes), but the task gets marked `completed` by the scheduler even though nothing was committed. The PRD implies this should be a distinct outcome - neither success nor failure, but a skipped/noop result. The `scheduler.ts` `completeTask` path at line 186-192 records 0 tokens and an empty branch as a "success". This is a semantic mismatch vs. PRD expectation.

### Story 4 (Quota Tracking) - One gap
- **AC: "Adjusts estimates based on rate limit responses from Claude CLI"** - `markRateLimited()` is called when the error string contains "rate limit", but this is a substring match on an error message (`errMsg.toLowerCase().includes("rate limit")` in `scheduler.ts` lines 197, 161). There is no structured detection of actual Claude CLI rate limit exit codes or response formats. This is fragile but partially implemented. No test covers the actual CLI rate limit output format.

### Story 5 (Execution Reports) - Three gaps
- **Local execution log with "full details" per task** - The logger writes daemon operational logs (what the scheduler did), but there is no per-task execution log entry that captures the full stdout/stderr output from Claude. The `ExecutionResult.stdout` and `ExecutionResult.stderr` fields are captured but never written to the log file.
- **Daily summary report** - Implemented via `checkDigests()` in `scheduler.ts` and `sendDailyDigest()` in `notify.ts`, but it only sends a Discord notification. There is no local log file equivalent of the daily summary as the PRD specifies ("Local execution log with full details").
- **Weekly summary report** - `checkDigests()` on the weekly cadence (lines 219-228) calls `sendDailyDigest()` again - it reuses the daily digest function rather than having a distinct weekly report. There is no per-project breakdown as the PRD specifies.

### Story 6 (Concurrency) - Two gaps
- **AC: "Concurrency scales down as quota depletes: high quota -> max concurrency, low quota -> serial"** - The scheduler uses `pickNextExcluding` in a loop and checks `slotAvailable <= 0` to break, but there is no graduated scaling logic. It is binary: either slots are filled or they're not. A single remaining small-task's worth of quota will still attempt to fill all concurrency slots.
- **AC: "Total concurrent sessions (manual + auto) respect subscription limits"** - There is no mechanism to count total concurrent sessions (manual + auto combined). The activity detector only distinguishes "user active" vs "user inactive" as a binary. If the user starts one manual session but stays "inactive" by the threshold window, QuotaFlow would still dispatch up to `max_concurrency` additional sessions, potentially exceeding plan limits.

### Feature 1 (Task Queue Manager) - Phase 2 CLI
- **"CLI commands for queue management (add, list, remove, reprioritize)"** - `add`, `list`, `rm`, and `status` are implemented (marked as Phase 2 in the PRD, but they exist). **`reprioritize` is missing.** There is no command to change a task's priority after creation.

---

## 2. Bugs or Issues in Current Code

### Bug 1: `git checkout` with branch names not quoted in shell commands
`executor.ts` lines 90, 134, 169, 195, 211:
```
await execAsync(`git checkout -b ${branchName}`, ...)
await execAsync(`git checkout ${originalBranch}`, ...)
await execAsync(`git branch -D ${branchName}`, ...)
```
`branchName` contains a slash (`quotaflow/task-...`) and `originalBranch` is user-controlled (from `git rev-parse`). Neither is shell-quoted. If `originalBranch` contained spaces or special characters (unlikely but possible in detached HEAD states or unusual git configurations), this would break. More concretely, the branch name itself is safe because it's built from `buildBranchName`, but `originalBranch` could be `HEAD` in detached HEAD state - `git checkout HEAD` succeeds but subsequent branch deletion would leave the repo on HEAD rather than a named branch.

### Bug 2: Token parsing falls back to character-count heuristic
`executor.ts` lines 118-130: If the Claude CLI JSON output does not have `usage.input_tokens`/`usage.output_tokens` OR `tokens_used` at the top level, the code falls back to `Math.floor(stdout.length / 4)`. This will produce wildly wrong numbers for all quota tracking if the CLI output format differs from what's expected. Given the PRD notes "Claude CLI output format changes" as a medium-probability risk, this silent fallback will corrupt quota estimates without any warning logged.

### Bug 3: `runStatus` in `cli.ts` computes misleading token display
`cli.ts` lines 134-153: `displayTotal = available + weekly.total_tokens`. This adds the current window's remaining tokens to the last 7 days of total usage - these are completely different things. The display reads "79,200 / 124,200" which is nonsensical. The correct total for the current 5-hour window is `tokens_per_5h_window * (1 - buffer/100)` = 79,200. The `runStatus` function cannot access config directly (it's not passed in), so it approximates - but the approximation is wrong and will confuse the user.

### Bug 4: Weekly quota check uses a nonsensical conversion formula
`scheduler.ts` line 91:
```
const weeklyLimitTokens = config.quota.weekly_compute_hours * 3600 * 10;
```
`weekly_compute_hours * 3600` converts hours to seconds. Multiplying by 10 "tokens/second compute" is an arbitrary magic number with no basis in the PRD or any documented Claude API behavior. The default config has `weekly_compute_hours: 200`, giving `200 * 3600 * 10 = 7,200,000` tokens as the weekly limit. The 5-hour window cap is 88,000 tokens. Running at full capacity for 7 days would consume at most `88000 * (24/5) * 7 = ~2.96M` tokens. The computed limit of 7.2M tokens is way beyond what's possible, making the weekly check effectively dead code that never fires.

### Bug 5: Digest scheduling uses local wall-clock hours, potentially timezone-mismatched
`scheduler.ts` line 209: `const currentHour = now.getHours()`. The digest test in `scheduler.test.ts` sets `vi.setSystemTime(new Date("2026-04-03T13:00:00.000Z"))` and sets `daily_report_hour = 8`, with a comment "Adjust config to match local hour: override to use UTC hour directly." This only works if the test runner is in UTC. In production on a UTC+8 timezone, `now.getHours()` would be 21 (9pm) when UTC is 13:00. The config's `daily_report_hour: 8` would trigger at 8am local which maps to 00:00 UTC - correct for the user. But the test is fragile and the code behavior depends entirely on system timezone, which is not documented anywhere.

### Bug 6: `addTask` in `queue.ts` does not validate `priority` or `size` values
`queue.ts` line 55-77: The function accepts `TaskPriority` and `TaskSize` types at compile time, but at runtime (e.g., direct JSON editing of `tasks.json`), any string passes through. If a user manually edits `tasks.json` with `"priority": "urgent"`, `PRIORITY_ORDER["urgent"]` returns `undefined`, and `sort` will produce NaN comparisons, resulting in unpredictable ordering. The `getQueued()` sort is silently broken.

---

## 3. Real-World Usage Blockers

### Blocker 1: No setup/installation instructions
The `scripts/start-daemon.sh` and `com.zylo.quotaflow.plist` are present, but there is no documented step to:
1. Copy config from `examples/config.json` to `~/.quotaflow/config.json`
2. Load the launchd plist: `launchctl load ~/Library/LaunchAgents/com.zylo.quotaflow.plist`
3. The plist lives in the repo root, not in `~/Library/LaunchAgents/` where launchd expects it. the user must copy or symlink it there manually - this is not documented.

### Blocker 2: `npx tsx` in the daemon script will be slow and fragile
`start-daemon.sh` uses `exec npx tsx src/index.ts`. `npx` resolves and downloads packages on first run if not cached. In a launchd context with limited PATH, this may fail silently. More critically, `tsx` is a dev dependency - there is no compiled output. The daemon requires the full dev toolchain to run. A compiled `dist/` would be safer for production use, but no build step exists.

### Blocker 3: `discord_webhook_url` is empty by default; no validation at startup
`DEFAULT_CONFIG` has `discord_webhook_url: ""`. The `Notifier` silently no-ops when the URL is empty (correct behavior). However, `validateConfig` does not warn or log that notifications are disabled. the user running the daemon for the first time with no webhook will get no feedback that tasks completed - the only output is local log files, which requires him to know to look in `~/.quotaflow/logs/`. There is no startup message printed to stdout confirming the webhook status clearly enough to catch a misconfiguration.

Actually, `index.ts` line 69 does log `webhook: config.discord_webhook_url ? "configured" : "not configured"` - but only to the log file, not stdout. Since `start-daemon.sh` uses `exec`, stdout goes to `~/.quotaflow/logs/daemon-stdout.log`, so the user can check it, but it's not obvious.

### Blocker 4: No handling of `claude` CLI not being in PATH for the launchd context
The plist does not set `PATH`. `start-daemon.sh` sources nvm to get Node, but `claude` (Claude Code CLI) must also be in PATH. If `claude` is installed via a different mechanism (e.g., into `~/.local/bin` or a Homebrew path), it may not be available in the launchd subprocess environment. The executor will fail every task with "command not found" and mark them all failed, with no clear error message that this is a PATH issue.

### Blocker 5: Concurrent task dispatch does not wait between picks - tokens double-counted
`scheduler.ts` lines 103-141: In the concurrency loop, `quota.getAvailableTokens()` is called for each slot, but usage is only recorded *after all tasks complete* (line 192). If two tasks are dispatched concurrently, each sees the same available token count. Two medium tasks (30K tokens each) could both be dispatched when only 35K tokens are actually available for the window. The quota accounting is correct after the fact, but the dispatch decision is wrong: it can over-commit tokens within a single tick.

### Blocker 6: No `safe` flag filtering despite being specified in the PRD
The PRD specifies tasks have a `safe` flag. The example `tasks.json` does not include it. There is no code anywhere that checks `task.safe`. the user cannot mark a task as unsafe to prevent automatic execution - every queued task will be dispatched. This means if the user adds an exploratory/destructive task to the queue (e.g., "Delete all test data and regenerate"), it will run automatically at night with no safeguard.
