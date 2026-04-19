# QuotaFlow

Local daemon for intelligent Claude Max token quota allocation across multiple local projects.

## Architecture

Single Node.js process daemon with 5-minute check loop + independent Telegram long-polling loop:
1. Detect user activity (pgrep for claude processes, with grace period)
2. Estimate remaining token quota (self-tracked via SQLite, 5h window + 7-day rolling)
3. Pick highest-priority tasks from JSON queue (up to max_concurrency, same-project excluded)
4. Execute via `claude -p` in isolated feature branches (resolves project path via multi-root fuzzy matching)
5. Log results, notify via Telegram or Discord, send daily/weekly digests
6. Telegram inbound: 30s long-polling with chat_id whitelist + passphrase + message_id dedup (fully try/catch-isolated)

## Tech Stack

- TypeScript + Node.js (ESM)
- SQLite via better-sqlite3 (quota tracking + smart size estimation)
- JSON file (task queue)
- vitest (testing, 199 tests)
- macOS launchd (daemon management)

## Project Structure

```
src/
  types.ts                     - Shared types and constants
  config.ts                    - Config loading + `getProjectsRoots()` multi-root helper
  queue.ts                     - Task queue manager (JSON-based, priority sorted)
  quota.ts                     - Token usage tracking (SQLite + WAL, window + weekly)
  activity.ts                  - Claude process detection with inactivity threshold
  executor.ts                  - Task execution with git branch isolation
  project-resolver.ts          - Multi-root fuzzy project name → path (exact/ci/prefix/substring/abs)
  notify.ts                    - Discord webhook notifier (fallback channel)
  telegram-notifier.ts         - Telegram MarkdownV2 notifier (preferred channel)
  telegram-state.ts            - last_update_id + processed_msg_ids FIFO (persisted JSON)
  telegram-command-parser.ts   - Pure parser: @Name + /add + /list + /status + /rm + /help
  telegram-poller.ts           - Independent 30s long-polling loop, try/catch-isolated
  logger.ts                    - Structured file logging (daily rotation)
  scheduler.ts                 - Main daemon loop (concurrent dispatch, re-entrancy guard)
  cli.ts                       - CLI subcommands (add/list/rm/status/template)
  templates.ts                 - Predefined task templates
  index.ts                     - Entry point: wires scheduler + poller
```

## CLI Commands

```bash
npx tsx src/index.ts add "task description" --project MyWebApp --priority high --size medium
npx tsx src/index.ts list              # Show tasks grouped by status
npx tsx src/index.ts rm <id>           # Remove task (mark as skipped)
npx tsx src/index.ts status            # Show quota and queue stats
npx tsx src/index.ts template review --project MyApiServer  # Create from template
npx tsx src/index.ts templates         # List available templates
npx tsx src/index.ts --dry-run         # Show what daemon would do
npx tsx src/index.ts                   # Start daemon
```

## Key Conventions

- ESM modules with .js import extensions in source
- vitest with globals enabled (no explicit imports needed)
- Tests in /tests directory mirroring src/ structure
- Temp directories via tmpdir() for all test I/O
- Dependencies injected into Scheduler for testability
- spawn() with argv array for git commit (no shell injection)

## Safety Rules

- NEVER push to remote from automated tasks
- NEVER commit to main branch
- ALL automated changes go to `quotaflow/task-{id}-*` branches
- Verify git working directory is clean before execution
- Recover stuck "running" tasks on startup
- checkDigests wrapped in try/catch to prevent daemon lockup
- Activity detector filters own child processes by command pattern

## Quota Management

Dual-layer quota awareness using real data from Claude CLI's rate_limit_event:

**Data source:** `--output-format stream-json --verbose` returns rate_limit_event with:
- `rateLimitType`: "five_hour" (session) or "seven_day" (weekly)
- `status`: "allowed" | "allowed_warning" | "rejected"
- `utilization`: 0.0-1.0 (percentage used)
- `isUsingOverage`: boolean (extra usage detection)
- `resetsAt`: Unix timestamp

**Task size tiers (calibrated from real data after 908K outlier):**
| Size | Target tokens | Typical use |
|------|---------------|-------------|
| small | ~15K | bug fix, 1-2 files |
| medium | ~60K | feature, 2-5 files |
| large | ~200K | refactor, 5-15 files |
| xlarge | ~800K | engineering plans, audits |

**Task size gating (applies to BOTH session and weekly, uses the stricter):**
| Utilization | Allowed task sizes |
|-------------|-------------------|
| < 60%       | small, medium, large, xlarge |
| 60-75%      | small, medium, large |
| 75-90%      | small only |
| >= 90%      | stop all dispatch |

**Task scope control:** Every dispatched task gets `AGENTS.md` scope contract injected into the prompt. Defines hard stops (no >50 files read, no >15 files modified), mandatory handover doc, and size-specific file count limits. This is the primary mechanism for preventing token blowouts.

**Pre-dispatch probe:** Runs `claude -p "ok"` before each dispatch cycle to check current quota status. Costs minimal tokens but provides real-time awareness.

**Extra usage protection:** If `isUsingOverage === true`, immediately stops dispatch.

## Configuration

- `~/.quotaflow/config.json` - Daemon settings (see examples/config.json)
- `~/.quotaflow/tasks.json` - Task queue
- `~/.quotaflow/logs/` - Execution logs (daily rotation)
- `~/.quotaflow/data.db` - SQLite usage tracking (WAL mode)
- `~/.quotaflow/telegram.state.json` - Long-poll offset + processed message_id cache (200 FIFO)

**Telegram setup** (optional but recommended for notifications + mobile enqueue):
- `telegram_bot_token` + `telegram_chat_id` → enables outbound notifications
- Add `telegram_command_secret` → also enables inbound commands (passphrase-gated)
- Multi-workspace: prefer `projects_roots: string[]` over legacy `projects_root: string`

**Mobile command syntax** (every message starts with the secret):
- `<secret> @ProjectName Fix bug` — fuzzy-match project, default size/priority
- `<secret> /add proj=X size=large pri=high <desc>` — full control
- `<secret> /list-projects` — enumerate all projects across roots

## Development

```bash
npm test           # Run all 133 tests
npm run test:watch # Watch mode
npm run dev        # Start daemon
```

## Roadmap

See `docs/ROADMAP.md` for full roadmap including P2.5 completion, permanently-dropped items (with debate rationale), and trigger-based future work.

**Permanently dropped (from 2026-04-07 debate):** Web dashboard, client-server architecture, sub-agent orchestration, task dependencies, per-project budget, architecture boundary tests.
