# QuotaFlow

Local daemon for intelligent Claude Max token quota allocation across multiple Zylo projects.

## Architecture

Single Node.js process daemon with 5-minute check loop:
1. Detect user activity (pgrep for claude processes, with grace period)
2. Estimate remaining token quota (self-tracked via SQLite, 5h window + 7-day rolling)
3. Pick highest-priority tasks from JSON queue (up to max_concurrency, same-project excluded)
4. Execute via `claude -p` in isolated feature branches
5. Log results, notify via Discord webhook, send daily/weekly digests

## Tech Stack

- TypeScript + Node.js (ESM)
- SQLite via better-sqlite3 (quota tracking + smart size estimation)
- JSON file (task queue)
- vitest (testing, 129 tests)
- macOS launchd (daemon management)

## Project Structure

```
src/
  types.ts      - Shared types and constants
  config.ts     - Configuration loading and validation
  queue.ts      - Task queue manager (JSON-based, priority sorted)
  quota.ts      - Token usage tracking (SQLite, window + weekly)
  activity.ts   - Claude process detection with inactivity threshold
  executor.ts   - Task execution with git branch isolation
  notify.ts     - Discord webhook notifications + daily/weekly digest
  logger.ts     - Structured file logging (daily rotation)
  scheduler.ts  - Main daemon loop (concurrent dispatch, re-entrancy guard)
  cli.ts        - CLI subcommands (add/list/rm/status/template)
  templates.ts  - Predefined task templates (review/test/lint/docs/refactor)
  index.ts      - Entry point (daemon or CLI routing)
```

## CLI Commands

```bash
npx tsx src/index.ts add "task description" --project Relay --priority high --size medium
npx tsx src/index.ts list              # Show tasks grouped by status
npx tsx src/index.ts rm <id>           # Remove task (mark as skipped)
npx tsx src/index.ts status            # Show quota and queue stats
npx tsx src/index.ts template review --project Athena  # Create from template
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

**Task size gating (applies to BOTH session and weekly, uses the stricter):**
| Utilization | Allowed task sizes |
|-------------|-------------------|
| < 60%       | small, medium, large |
| 60-75%      | small, medium |
| 75-90%      | small only |
| >= 90%      | stop all dispatch |

**Pre-dispatch probe:** Runs `claude -p "ok"` before each dispatch cycle to check current quota status. Costs minimal tokens but provides real-time awareness.

**Extra usage protection:** If `isUsingOverage === true`, immediately stops dispatch.

## Configuration

- `~/.quotaflow/config.json` - Daemon settings (see examples/config.json)
- `~/.quotaflow/tasks.json` - Task queue
- `~/.quotaflow/logs/` - Execution logs (daily rotation)
- `~/.quotaflow/data.db` - SQLite usage tracking

## Development

```bash
npm test           # Run all 133 tests
npm run test:watch # Watch mode
npm run dev        # Start daemon
```

## Next Steps (P3 - As Needed)

- Web dashboard for task management and usage visualization
- TODO.md / CLAUDE.md scanning to auto-generate tasks
- OpenClaw integration as execution backend
- Multi-subscription support
- GitHub issue auto-conversion to tasks
