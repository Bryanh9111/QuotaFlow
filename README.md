# QuotaFlow

Local daemon that maximizes Claude Max subscription token utilization by automatically dispatching development tasks during idle periods.

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start daemon (development)
npm run dev
```

## Setup

1. Copy example config:
```bash
mkdir -p ~/.quotaflow
cp examples/config.json ~/.quotaflow/config.json
cp examples/tasks.json ~/.quotaflow/tasks.json
```

2. Edit `~/.quotaflow/config.json` with your Discord webhook URL and preferences.

3. Add tasks to `~/.quotaflow/tasks.json`.

4. Start the daemon:
```bash
npm run dev
```

## Install as launchd Service

```bash
cp com.zylo.quotaflow.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.zylo.quotaflow.plist
```

## Task Format

```json
{
  "id": "001",
  "description": "Add input validation to /api/webhook endpoint",
  "project": "Relay",
  "priority": "high",
  "size": "medium",
  "status": "queued",
  "created_at": "2026-04-03T00:00:00Z"
}
```

- **priority**: high | medium | low
- **size**: small (~10K tokens) | medium (~30K tokens) | large (~60K tokens)
- **status**: queued | running | completed | failed | skipped
