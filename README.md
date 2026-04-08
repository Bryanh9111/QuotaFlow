# QuotaFlow

Local daemon that maximizes Claude Max subscription value by automatically dispatching Claude Code tasks during your idle time. Built-in dual-layer quota awareness (5h session + weekly), safe git isolation, and automatic scope control.

**Zero additional cost** — uses your existing Claude Max subscription via `claude -p` headless mode.

## What it does

1. Detects when you're not actively using Claude (pgrep-based)
2. Probes real rate limit status from Claude CLI's `stream-json` output
3. Picks prioritized tasks from a JSON queue
4. Executes them via `claude -p` in isolated git feature branches
5. Commits results (never pushes, never touches main)
6. Generates handover docs per task, sends Discord notifications
7. Automatically backs off when quota gets tight

## Quick Install (new machine)

```bash
# 1. Clone the repo
git clone https://github.com/Bryanh9111/QuotaFlow.git ~/Repos/QuotaFlow
cd ~/Repos/QuotaFlow

# 2. Install dependencies (requires Node.js 20+ via nvm)
npm install

# 3. Run tests to verify installation
npm test

# 4. Create config directory and copy example
mkdir -p ~/.quotaflow
cp examples/config.json ~/.quotaflow/config.json

# 5. Edit config to set your projects_root and (optional) Discord webhook
vi ~/.quotaflow/config.json
```

### Required Config Fields

Edit `~/.quotaflow/config.json`:

```json
{
  "projects_root": "/Users/YOUR_USER/Repos/YourWorkspace",
  "discord_webhook_url": "https://discord.com/api/webhooks/..."
}
```

All other fields have sensible defaults.

### Prerequisites

- **Node.js 20+** (install via nvm: `nvm install 20`)
- **Claude Code CLI** installed and authenticated (`claude auth`)
- **Git** with a clean working directory on target projects
- **macOS** (Linux should work but untested for launchd)

## Usage

### Add a task

```bash
cd ~/Repos/QuotaFlow

# Manual task
npx tsx src/index.ts add "Review auth module for security issues" \
  --project MyWebApp --priority high --size medium

# From template
npx tsx src/index.ts template review --project MyApiServer
npx tsx src/index.ts templates  # list available templates
```

### Check status

```bash
npx tsx src/index.ts status        # show quota + queue stats
npx tsx src/index.ts list          # show tasks grouped by status
```

### Run the daemon

```bash
# Foreground (for testing)
npx tsx src/index.ts

# Dry run (see what would happen without executing)
npx tsx src/index.ts --dry-run

# Background (production)
nohup npx tsx src/index.ts > /dev/null 2>&1 &
```

### Install as macOS launchd service (auto-start)

```bash
# 1. Copy the template and substitute paths
sed \
  -e "s|{HOME}|$HOME|g" \
  -e "s|{QUOTAFLOW_DIR}|$(pwd)|g" \
  examples/quotaflow.plist.template \
  > ~/Library/LaunchAgents/com.quotaflow.daemon.plist

# 2. Load
launchctl load ~/Library/LaunchAgents/com.quotaflow.daemon.plist

# Check status
launchctl list | grep quotaflow

# Stop
launchctl unload ~/Library/LaunchAgents/com.quotaflow.daemon.plist
```

## Agent Integration Guide

**For AI agents working on or integrating with this repo:** read `AGENTS.md` and `CLAUDE.md` first. They contain:

- **AGENTS.md**: The task scope contract injected into every dispatched task. Defines size budgets, hard stops, and handover requirements. If you're running a task via QuotaFlow, these rules apply.
- **CLAUDE.md**: Project conventions, architecture overview, safety rules, and command reference.

### Key Integration Points

1. **Task schema** (`src/types.ts`):
   ```typescript
   interface Task {
     id: string;
     description: string;
     project: string;     // must match a subdirectory in projects_root
     priority: "high" | "medium" | "low";
     size: "small" | "medium" | "large" | "xlarge";
     status: "queued" | "running" | "completed" | "failed" | "skipped";
   }
   ```

2. **Task sizes calibrated against real data:**
   - `small` ~15K tokens (bug fix, 1-2 files)
   - `medium` ~60K tokens (feature, 2-5 files)
   - `large` ~200K tokens (refactor, 5-15 files)
   - `xlarge` ~800K tokens (engineering plans, full audits)

3. **Handover docs** are automatically created at `doc/handover-{task-id}.md` in each target project on task completion.

4. **Feature branches** follow the pattern `quotaflow/task-{id}-{slug}` and are never pushed to remote.

## Configuration Reference

```json
{
  "projects_root": "/path/to/your/workspace",
  "inactivity_threshold_minutes": 15,
  "check_interval_minutes": 5,
  "max_concurrency": 1,
  "discord_webhook_url": "https://discord.com/api/webhooks/...",
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

## How Quota Awareness Works

QuotaFlow parses Claude CLI's `rate_limit_event` from `stream-json` output to get **real** quota state:

- `status`: "allowed" | "allowed_warning" | "rejected"
- `utilization`: 0.0-1.0 (actual percentage used)
- `isUsingOverage`: whether you're into extra-usage territory
- `resetsAt`: Unix timestamp for window reset

### Task size gating (applies to BOTH session and weekly limits, takes the stricter):

| Utilization | Allowed sizes |
|-------------|---------------|
| < 60%       | small, medium, large, xlarge |
| 60-75%      | small, medium, large |
| 75-90%      | small only |
| ≥ 90%       | **stop all dispatch** |

If `isUsingOverage === true`, dispatch stops immediately to preserve your extra-usage balance.

## Safety Rules

- **NEVER** pushes to remote
- **NEVER** commits to main branch
- **ALL** changes go to `quotaflow/task-{id}-*` feature branches
- Verifies `git status --porcelain` is clean before creating branches
- Filters own daemon processes from activity detection
- `spawn()` with argv array (no shell injection)
- Path traversal blocked (`resolve() + startsWith()`)

## Files & Paths

| Path | Purpose |
|------|---------|
| `~/.quotaflow/config.json` | Daemon settings |
| `~/.quotaflow/tasks.json` | Task queue (JSON, edit manually or via CLI) |
| `~/.quotaflow/data.db` | SQLite usage history |
| `~/.quotaflow/logs/YYYY-MM-DD.log` | Execution logs (daily rotation) |
| `docs/ROADMAP.md` | Future work and decisions |
| `AGENTS.md` | Task scope contract (injected into every task prompt) |
| `CLAUDE.md` | Project conventions |

## Development

```bash
npm test           # Run all 133 tests
npm run test:watch # Watch mode
npm run dev        # Start daemon
```

## License

ISC
