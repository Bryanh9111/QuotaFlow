# QuotaFlow

> **Status (2026-05-01)**: paused pending build trigger. The 4-way `octo:debate` (Codex / Gemini / Sonnet / Opus, 4/4 consensus) plus an empirical stress-test concluded that `claude -p` (`--max-budget-usd`, `--dangerously-skip-permissions`, `--add-dir`, `--effort`, `--output-format json`, `--mcp-config`, `--json-schema`) and `codex exec --full-auto` already ship every v0.1 primitive QuotaFlow was meant to add. The genuine remaining gap (persistent SQLite queue, sequential dispatch, global-quota gate, cross-project status board, push notification) reduces to a ~200 LoC single-file `~/bin/qf` wrapper, not a daemon project. Build trigger: 3 missing-feature pain incidents in 2 weeks of real work. See `debates/001-scope-identity-2026-04-30/synthesis.md` and `stress-test-results.md`. Pinned Engram decision id `0f74f15de8f3` (supersedes `89973613abd2`).

> A local daemon that runs Claude Code tasks during your idle time, using quota you'd otherwise waste. Zero extra cost, safe git isolation, dual-layer quota awareness.

**Problem it solves:** Claude Max subscribers waste 30-50% of their 5-hour token window while sleeping or away. QuotaFlow uses that idle quota to run real development tasks (code review, refactors, engineering plans) in the background, committing results to feature branches for review when you return.

**Key features:**
- Dual-layer quota awareness (5h session + 7-day weekly) from Claude CLI's real `rate_limit_event` data
- Task scope control via AGENTS.md contract injected into every task prompt (prevents 908K-token blowouts)
- Safe git isolation: commits to `quotaflow/task-*` branches, never touches `main`, never pushes to remote
- Auto handover docs per task for seamless session-to-session context transfer
- Telegram or Discord notifications with per-project breakdown and outlier detection
- Task size tiers calibrated from real data (small 15K / medium 60K / large 200K / xlarge 800K tokens)

---

## What is QuotaFlow?

QuotaFlow is a **local background daemon** for macOS (Linux untested) that schedules [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) tasks during user idle time. It is NOT:
- A Claude API wrapper (uses your existing Max subscription via `claude -p` headless mode)
- A web service (no server, no UI, runs locally)
- A replacement for interactive Claude Code (only runs when you're not using it)
- A multi-machine orchestrator (single machine, single subscription)

It IS:
- A smart cron job that picks the right task at the right time based on real quota state
- A scope-control layer that prevents runaway tasks via prompt injection
- A measurement instrument that learns real token costs per task size

---

## Quick Install (New Machine, 5 Minutes)

```bash
# 1. Clone the repo
git clone https://github.com/Bryanh9111/QuotaFlow.git ~/Repos/QuotaFlow
cd ~/Repos/QuotaFlow

# 2. Install Node.js dependencies (requires Node 20+ via nvm)
npm install

# 3. Run tests to verify installation
npm test
# Expected: Test Files 11 passed, Tests 133 passed

# 4. Create config directory and copy example
mkdir -p ~/.quotaflow
cp examples/config.json ~/.quotaflow/config.json

# 5. Edit config - set projects_root to your workspace path
vi ~/.quotaflow/config.json
```

### Prerequisites

| Requirement | How to install |
|-------------|----------------|
| Node.js 20+ | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh \| bash` then `nvm install 20` |
| Claude Code CLI | See [Claude Code install guide](https://docs.claude.com/en/docs/claude-code/setup) then `claude auth` |
| Claude Max subscription | Required - QuotaFlow uses your existing subscription, no API key needed |
| Git | Pre-installed on macOS, or `brew install git` |
| macOS | Linux should work but launchd service is macOS-only |

### Required Config Fields

Only two fields need attention in `~/.quotaflow/config.json`:

```json
{
  "projects_roots": [
    "$HOME/Repos/Workspace",
    "$HOME/Repos/Personal"
  ],
  "telegram_bot_token": "123456:ABCDEF...",
  "telegram_chat_id": "1234567890"
}
```

- **`projects_roots`**: Array of absolute paths to parent directories containing projects QuotaFlow can operate on. When you add a task with `--project MyWebApp`, QuotaFlow searches each root in order and picks the first match. Legacy `projects_root` (singular string) is still accepted and is merged into the search list.
- **Notifications**: Choose one channel (both optional, leave all empty to disable):
  - **Telegram** (recommended): Create a bot via [@BotFather](https://t.me/BotFather) → `/newbot` → copy token. Send your bot `/start`, then GET `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your `chat.id`. Fill `telegram_bot_token` + `telegram_chat_id`.
  - **Discord**: Server → Settings → Integrations → Webhooks → New Webhook → Copy URL. Fill `discord_webhook_url`.
  - Telegram takes precedence if both are configured.

All other fields have sensible defaults (see Configuration Reference below).

---

## First Task Walkthrough

Let's run your first task end-to-end. Assumes install is complete.

```bash
cd ~/Repos/QuotaFlow

# 1. Check current quota and queue state
npx tsx src/index.ts status
# Output:
# QuotaFlow Status
#   Window tokens: 79,200 / 79,200 available
#   Weekly usage: 0 tokens (0 tasks)
#   Queued tasks: 0

# 2. Add a small task using a built-in template
npx tsx src/index.ts template review --project YourProject
# Output: Task added from template 'review': [medium] abc12345 | YourProject | ...

# 3. See it in the queue
npx tsx src/index.ts list
# Output: QUEUED
#   [medium] abc12345 | YourProject | Review recent changes...

# 4. Dry-run to verify scheduler would dispatch it
npx tsx src/index.ts --dry-run
# Expected: "[DRY RUN] would execute task { id: 'abc12345', ... }"
# Ctrl+C to exit

# 5. Run daemon in foreground (for testing)
npx tsx src/index.ts
# Keep running, close all other claude sessions, wait 15 minutes
# Daemon will detect inactivity, dispatch the task, commit to feature branch

# 6. After daemon runs the task, check the branch in your project
cd /path/to/projects_root/YourProject
git branch | grep quotaflow
# Should show: quotaflow/task-abc12345-*

git log quotaflow/task-abc12345-* --oneline -5
# Should show the task's commit
```

---

## Usage Reference

### Task management commands

```bash
# Add a manual task
npx tsx src/index.ts add "Review auth module for security issues" \
  --project MyWebApp --priority high --size medium

# Add from a template
npx tsx src/index.ts template review --project MyApiServer
npx tsx src/index.ts templates  # list available templates

# List all tasks grouped by status
npx tsx src/index.ts list

# Remove a task (marks as skipped)
npx tsx src/index.ts rm <task-id>

# Show current quota and queue stats
npx tsx src/index.ts status
```

### Running the daemon

```bash
# Foreground (for testing/debugging)
npx tsx src/index.ts

# Dry run (shows what would happen without executing tasks)
npx tsx src/index.ts --dry-run

# Background (production)
nohup npx tsx src/index.ts > /dev/null 2>&1 &
```

### Install as macOS launchd service (auto-start)

```bash
# Copy the template and substitute paths
sed \
  -e "s|{HOME}|$HOME|g" \
  -e "s|{QUOTAFLOW_DIR}|$(pwd)|g" \
  examples/quotaflow.plist.template \
  > ~/Library/LaunchAgents/com.quotaflow.daemon.plist

# Load
launchctl load ~/Library/LaunchAgents/com.quotaflow.daemon.plist

# Check status
launchctl list | grep quotaflow

# Stop
launchctl unload ~/Library/LaunchAgents/com.quotaflow.daemon.plist
```

---

## Configuration Reference

Full `~/.quotaflow/config.json` schema:

```json
{
  "projects_root": "",
  "projects_roots": [
    "$HOME/Repos/Workspace",
    "$HOME/Repos/Personal"
  ],
  "inactivity_threshold_minutes": 15,
  "check_interval_minutes": 5,
  "max_concurrency": 1,
  "discord_webhook_url": "https://discord.com/api/webhooks/...",
  "telegram_bot_token": "",
  "telegram_chat_id": "",
  "telegram_command_secret": "",
  "default_size": "medium",
  "default_priority": "medium",
  "quota": {
    "tokens_per_5h_window": 88000,
    "weekly_compute_hours": 200,
    "safety_buffer_percent": 10
  },
  "timeouts": {
    "small_minutes": 5,
    "medium_minutes": 15,
    "large_minutes": 45,
    "xlarge_minutes": 90
  },
  "daily_report_hour": 8,
  "weekly_report_day": 1
}
```

| Field | Default | Purpose |
|-------|---------|---------|
| `projects_root` | `""` | Legacy single-root form (merged into search list) |
| `projects_roots` | `[]` | Array of absolute paths to scan for projects (first match wins on duplicates) |
| `inactivity_threshold_minutes` | `15` | Minutes of no claude activity before daemon is eligible to dispatch |
| `check_interval_minutes` | `5` | How often daemon wakes up to check conditions |
| `max_concurrency` | `1` | Max simultaneous dispatched tasks |
| `discord_webhook_url` | `""` | Discord webhook for notifications (empty disables) |
| `telegram_bot_token` | `""` | Telegram bot token (takes precedence over Discord if set with chat_id) |
| `telegram_chat_id` | `""` | Telegram chat ID (private chat or channel, negative for channels) |
| `telegram_command_secret` | `""` | Passphrase prefix required for inbound commands (empty disables inbound) |
| `default_size` | `"medium"` | Default task size when `@Project` shortcut omits size |
| `default_priority` | `"medium"` | Default task priority when `@Project` shortcut omits priority |
| `quota.tokens_per_5h_window` | `88000` | Max 5x session window capacity (approximate) |
| `quota.safety_buffer_percent` | `10` | Percentage reserved from each window for safety |
| `timeouts.*_minutes` | `5/15/45/90` | Wall-clock timeout per task size |

---

## Inbound Commands via Telegram

If `telegram_bot_token` + `telegram_chat_id` + `telegram_command_secret` are all set, QuotaFlow starts a long-polling loop that accepts commands from Telegram. Three security layers:

1. **chat_id whitelist**: only messages from the configured chat are processed (others silently dropped)
2. **Passphrase prefix**: every message must begin with the `telegram_command_secret` (defense against Telegram account compromise)
3. **Message dedup**: `message_id` cached in `~/.quotaflow/telegram.state.json` prevents replay via `getUpdates` retries

**Command format** (every message starts with your secret, then either `@Project` shortcut or a slash command):

```
<secret> @QuotaFlow Fix login bug                   # shortcut: project name via fuzzy match + defaults
<secret> /add proj=QuotaFlow size=large pri=high Fix X  # full control
<secret> /list [N]                                  # show first N queued tasks (default 10)
<secret> /list-projects                             # enumerate all projects in configured roots
<secret> /status                                    # available tokens + queue count
<secret> /rm <task-id>                              # remove queued task
<secret> /help                                      # command reference
```

**Fuzzy project matching order** (`@Name` or `proj=Name`):
1. Exact name match (case-sensitive)
2. Case-insensitive exact
3. Unambiguous prefix
4. Unambiguous substring
5. Absolute path inside a configured root

When ambiguous or unknown, the bot replies with candidates.

**Example workflow**:

```
You → bot: qf-a9f3x21 @QuotaFlow Review auth module for memory leaks
bot → you: Queued `abc12345`
          project: `QuotaFlow` | size: medium | priority: medium

You → bot: qf-a9f3x21 @Blo Write post draft
bot → you: Queued `def67890`
          project: `Blog` (matched via prefix) | size: medium | priority: medium
```

**Safety notes**:

- The poller runs in absolute isolation (dedicated `setTimeout` loop + `try/catch` wrap) - a bug or Telegram outage cannot crash the scheduler
- Task descriptions enter the queue via the existing `queue.addTask()` API, which is already used by the CLI; no shell interpolation
- Rotate `telegram_command_secret` by editing config + restarting daemon; unknown-secret messages are silently dropped

---

## How Quota Awareness Works

QuotaFlow parses Claude CLI's `rate_limit_event` from `stream-json --verbose` output to get real quota state from Anthropic's API:

```json
{
  "type": "rate_limit_event",
  "rate_limit_info": {
    "status": "allowed",
    "rateLimitType": "five_hour",
    "utilization": 0.47,
    "isUsingOverage": false,
    "resetsAt": 1775826000
  }
}
```

Both `five_hour` (session) and `seven_day` (weekly) events are parsed on every pre-dispatch probe. The daemon uses the stricter of the two when deciding what task sizes to allow:

### Task size gating

| Utilization | Allowed task sizes |
|-------------|---------------------|
| < 60%       | small, medium, large, xlarge |
| 60-75%      | small, medium, large |
| 75-90%      | small only |
| ≥ 90%       | **stop all dispatch** |

If `isUsingOverage === true`, dispatch stops immediately to preserve your extra-usage balance.

---

## Agent Integration Guide

**For AI agents (Claude, Cursor, etc.) working on or extending this repo:** read `AGENTS.md` and `CLAUDE.md` first.

- **`AGENTS.md`** — The task scope contract injected into every dispatched `claude -p` prompt. Defines hard stops (max files read/modified, mandatory handover doc, abort conditions). If you're writing a task to be run by QuotaFlow, these rules apply.
- **`CLAUDE.md`** — Project conventions, architecture, safety rules, command reference.
- **`docs/ROADMAP.md`** — Current roadmap, permanently-dropped features with debate rationale, and trigger-based future work.
- **`docs/debates/`** — 4-way AI debate records (Claude/Sonnet/Gemini/Codex) documenting major architectural decisions.

### Task schema

From `src/types.ts`:

```typescript
interface Task {
  id: string;                    // 8-char UUID
  description: string;           // Task prompt (AGENTS.md contract prepended at execution)
  project: string;               // Must match subdirectory in projects_root
  priority: "high" | "medium" | "low";
  size: "small" | "medium" | "large" | "xlarge";
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  created_at: string;
  completed_at?: string;
  tokens_used?: number;
  branch?: string;
  duration_ms?: number;
  error?: string;
}
```

### Task size calibration (from real observations)

| Size | Target tokens | Typical use | Timeout |
|------|---------------|-------------|---------|
| small | ~15K | Bug fix, 1-2 file review | 5 min |
| medium | ~60K | Feature implementation, 2-5 files | 15 min |
| large | ~200K | Multi-file refactor, 5-15 files | 45 min |
| xlarge | ~800K | Engineering plans, full audits | 90 min |

Real data point: An xlarge engineering plan task consumed 908K tokens in 6 minutes. The `large=60K` estimate from the MVP phase was wrong by 15x — hence xlarge tier was added and all defaults recalibrated.

---

## Safety Rules

QuotaFlow runs unattended during idle time. These rules prevent damage:

- **NEVER** pushes to remote
- **NEVER** commits to `main` branch
- **ALL** changes go to `quotaflow/task-{id}-*` feature branches
- Verifies `git status --porcelain` is clean before creating branches (refuses dirty workdirs)
- Filters own daemon processes from activity detection (won't mistake itself for user activity)
- `spawn()` with argv array for git commit (no shell injection surface)
- Path traversal blocked via `resolve() + startsWith(projects_root)` check
- `checkDigests()` wrapped in try/catch to prevent daemon lockup on notification failures
- `--dangerously-skip-permissions` is set for `claude -p` to allow file writes, so ensure only trusted tasks enter the queue

---

## Files & Paths

| Path | Purpose |
|------|---------|
| `~/.quotaflow/config.json` | Daemon settings (not in repo) |
| `~/.quotaflow/tasks.json` | Task queue state |
| `~/.quotaflow/data.db` | SQLite usage history |
| `~/.quotaflow/logs/YYYY-MM-DD.log` | Execution logs (daily rotation) |
| `~/.quotaflow/telegram.state.json` | Telegram poll offset + processed message_id cache |
| `docs/ROADMAP.md` | Roadmap and dropped features |
| `docs/debates/` | AI debate decision records |
| `AGENTS.md` | Task scope contract (injected into every task prompt) |
| `CLAUDE.md` | Project conventions |
| `examples/config.json` | Config template |
| `examples/tasks.json` | Task file example |
| `examples/quotaflow.plist.template` | launchd service template |

---

## Troubleshooting

### "Test failed: Cannot find module 'better-sqlite3'"
Run `npm install` again. better-sqlite3 is a native module and may need rebuild: `npm rebuild better-sqlite3`.

### Daemon logs show "tick skipped: user active" continuously
QuotaFlow detects your interactive Claude sessions and pauses. This is correct behavior. Either close your claude sessions and wait 15 minutes (default inactivity threshold), or reduce `inactivity_threshold_minutes` in config for testing.

### Daemon logs show "tick skipped: window exhausted"
Your Claude Max quota is rate-limited or using overage. Check the `resetsAt` timestamp in logs — daemon will automatically resume when the window resets.

### Task failed with "working directory not clean"
The target project has uncommitted changes. QuotaFlow refuses to operate on dirty workdirs for safety. Either commit/stash your changes or QuotaFlow will skip that project.

### "claude: command not found" when daemon dispatches
Claude CLI is not in the PATH available to the daemon. If running via launchd, the `scripts/start-daemon.sh` wrapper sources nvm to fix this. If still failing, ensure `claude` is installed via `which claude` and add its directory to the PATH export in `start-daemon.sh`.

### Daemon never dispatches despite queue having tasks
Check logs in `~/.quotaflow/logs/$(date +%Y-%m-%d).log` for which condition is failing: `tick skipped: user active`, `tick skipped: window exhausted`, `tick skipped: no tasks`, or `weekly quota limit reached`. The log line tells you exactly which gate blocked dispatch.

### Notifications not arriving
**Telegram**: Test manually: `curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" -d "chat_id=<ID>" -d "text=test"`. If this fails, verify the token via `https://api.telegram.org/bot<TOKEN>/getMe`. If chat_id is wrong, you must first send `/start` to the bot from that chat, then fetch it via `https://api.telegram.org/bot<TOKEN>/getUpdates`.

**Discord**: Test webhook manually: `curl -X POST -H 'Content-Type: application/json' -d '{"content":"test"}' YOUR_WEBHOOK_URL`. If this fails, the webhook URL is invalid.

If manual test works but QuotaFlow doesn't notify, check `~/.quotaflow/logs/*.log` and verify the `notify_channel` value on startup matches your expected adapter.

### Tokens consumed much more than estimated
This is expected for xlarge tasks and documented in the size calibration section. The estimator learns from history after 3 samples per size. To reset the learning state, delete `~/.quotaflow/data.db` (only affects quota tracking, not task queue).

---

## FAQ

### How is this different from OpenClaw or other Claude orchestrators?
OpenClaw manages multiple Claude Code instances across machines (execution layer). QuotaFlow is a single-machine decision layer that decides what task to run when, based on real quota state. They could be composed but QuotaFlow does not require OpenClaw and works standalone.

### Does this cost extra money?
No. QuotaFlow uses your existing Claude Max subscription via `claude -p` headless mode. It only consumes quota you'd otherwise waste during idle time. The only cost is if you enable Extra Usage on your Claude account — QuotaFlow respects `isUsingOverage` and stops dispatch if detected.

### Why not just use cron or launchd directly?
A simple cron would blindly run tasks regardless of quota state, user activity, or task size. QuotaFlow adds: real-time quota awareness, activity detection, task size gating, handover doc generation, feature branch isolation, and outlier detection. Cron just fires timestamps.

### Can I use this with Claude Pro instead of Max?
Should work but not tested. Adjust `tokens_per_5h_window` in config to match your tier's capacity.

### Is this safe to run on my main projects?
Yes, subject to the safety rules above. QuotaFlow never pushes to remote, never touches main, commits only to feature branches, and refuses dirty workdirs. Worst case: you get a broken feature branch that you can delete.

### Why TypeScript + Node.js instead of Python/Go/Rust?
Same ecosystem as Claude Code CLI, native async I/O for process management, no build step via tsx, and vitest for fast testing. Zero ideology — "boring technology wins" per the debate decisions.

### What happens if the daemon crashes mid-task?
On startup, QuotaFlow scans for tasks in `running` status and resets them to `queued`. The crashed task's feature branch may exist but will be cleaned up on next attempt. No data corruption because tasks.json is atomic JSON writes.

### Can I add my own agent CLI (not Claude Code)?
Not currently. The `TaskExecutor` is hardcoded to `claude`. An `AgentAdapter` interface is on the trigger-based roadmap (see `docs/ROADMAP.md`) — will be added when a second CLI alternative exists.

### Where are the decision records?
See `docs/debates/` for 4-way AI debate records between Claude Opus, Sonnet, Gemini, and Codex. Each major architectural decision has a synthesis document explaining why features were kept, dropped, or deferred.

---

## Development

```bash
npm test           # Run all 133 tests
npm run test:watch # Watch mode
npm run dev        # Start daemon in foreground
```

Architecture overview: see `CLAUDE.md` and `docs/quotaflow-prd.md`.

---

## License

ISC — see [LICENSE](LICENSE).
