# QuotaFlow

Local daemon for intelligent Claude Max token quota allocation across multiple Zylo projects.

## Architecture

Single Node.js process daemon with 5-minute check loop:
1. Detect user activity (pgrep for claude processes)
2. Estimate remaining token quota (self-tracked via SQLite)
3. Pick highest-priority task from JSON queue
4. Execute via `claude -p` in an isolated feature branch
5. Log results, notify via Discord webhook

## Tech Stack

- TypeScript + Node.js (ESM)
- SQLite via better-sqlite3 (quota tracking)
- JSON file (task queue)
- vitest (testing)
- macOS launchd (daemon management)

## Project Structure

```
src/
  types.ts      - Shared types and constants
  config.ts     - Configuration loading and validation
  queue.ts      - Task queue manager (JSON-based)
  quota.ts      - Token usage tracking (SQLite)
  activity.ts   - Claude process detection
  executor.ts   - Task execution with git branch isolation
  notify.ts     - Discord webhook notifications
  logger.ts     - Structured file logging
  scheduler.ts  - Main daemon loop
  index.ts      - Entry point
```

## Key Conventions

- ESM modules with .js import extensions in source
- vitest with globals enabled (no explicit imports needed)
- Tests in /tests directory mirroring src/ structure
- Temp directories via tmpdir() for all test I/O
- Dependencies injected into Scheduler for testability

## Safety Rules

- NEVER push to remote from automated tasks
- NEVER commit to main branch
- ALL automated changes go to `quotaflow/task-{id}-*` branches
- Verify git working directory is clean before execution
- Recover stuck "running" tasks on startup

## Commands

```bash
npm test          # Run all tests
npm run test:watch # Watch mode
npm run dev       # Start daemon
```

## Configuration

- `~/.quotaflow/config.json` - Daemon settings
- `~/.quotaflow/tasks.json` - Task queue
- `~/.quotaflow/logs/` - Execution logs
- `~/.quotaflow/data.db` - SQLite usage tracking
