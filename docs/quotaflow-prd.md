# Product Requirements Document: QuotaFlow

**Version**: 1.0
**Date**: 2026-04-03
**Author**: Sarah (Product Owner)
**Quality Score**: 91/100

---

## Executive Summary

QuotaFlow is a local daemon that maximizes Claude Max subscription token utilization by automatically dispatching development tasks during idle periods. Currently, when the subscriber is sleeping or away, the 5-hour rolling token window resets unused -- representing significant wasted value on a $100/month Max 5x plan.

QuotaFlow solves this by maintaining a central task queue across multiple projects, monitoring token quota consumption, detecting user activity, and automatically executing queued tasks via Claude Code CLI when the user is inactive. Tasks are committed to feature branches for human review, with execution summaries delivered via Discord and local logs.

The system manages ~88,000 tokens per 5-hour window and ~140-280 Sonnet compute hours per 7-day rolling limit, ensuring both windows are fully utilized without overrunning.

---

## Problem Statement

**Current Situation**: A Claude Max 5x subscriber manages 8 active projects under a single workspace. During active hours (roughly 12-16h/day), they run 1-4 concurrent Claude sessions manually. During sleep and away time (~8-12h/day), the 5-hour token windows reset with unused quota -- an estimated 30-50% of total available capacity goes to waste.

**Proposed Solution**: A local 24/7 daemon that detects user inactivity, estimates remaining quota, and automatically dispatches prioritized development tasks from a central queue to Claude Code CLI sessions across all managed projects.

**Business Impact**: Near-100% token utilization across all 5-hour windows and the weekly rolling limit, effectively doubling the productive output from the existing $100/month subscription without additional cost.

---

## Success Metrics

**Primary KPIs:**
- **Token Utilization Rate**: Target 90%+ of each 5-hour window consumed (up from estimated 50-60%)
- **Weekly Quota Utilization**: Target 95%+ of 7-day rolling limit consumed
- **Task Completion Rate**: >80% of auto-dispatched tasks complete successfully without human intervention

**Secondary KPIs:**
- Zero interference with manual sessions (daemon never competes for quota when user is active)
- Average task queue depth stays below 5 (tasks are being consumed, not piling up)

**Validation**: Tracked via QuotaFlow's built-in usage logging. Weekly reports compare actual vs. theoretical maximum utilization.

---

## User Personas

### Primary: Solo Developer / Subscriber
- **Role**: Full-stack developer managing multiple projects
- **Goals**: Maximize development velocity across 8 projects without increasing subscription cost
- **Pain Points**: Token quota wasted during sleep/away hours; manual context-switching between projects is overhead
- **Technical Level**: Advanced -- comfortable with CLI, JSON config, Claude Code workflows

---

## User Stories & Acceptance Criteria

### Story 1: Add Tasks to Central Queue

**As a** developer
**I want to** add tasks to a central JSON queue with project, priority, and size metadata
**So that** QuotaFlow knows what to work on when I'm away

**Acceptance Criteria:**
- [ ] Tasks defined in a JSON file with fields: description, project path, priority (high/medium/low), estimated size (small/medium/large), safe flag
- [ ] Tasks can target any project under the configured workspace
- [ ] Invalid project paths or malformed entries are rejected with clear error messages
- [ ] Task queue persists across daemon restarts

### Story 2: Automatic Task Dispatch During Idle

**As a** subscriber
**I want to** have tasks automatically executed when I'm not actively using Claude
**So that** my token quota doesn't go to waste

**Acceptance Criteria:**
- [ ] Daemon detects user inactivity (no active Claude sessions for N minutes, configurable)
- [ ] Daemon estimates remaining quota in current 5-hour window
- [ ] Tasks are dispatched in priority order, matching task size to available quota
- [ ] Large tasks only dispatched when quota is sufficient; small tasks used to fill remaining quota
- [ ] Execution stops when quota is estimated to be exhausted or user becomes active

### Story 3: Safe Execution with Feature Branch Commits

**As a** developer
**I want to** auto-executed tasks to commit to feature branches only
**So that** I can review all changes before they reach main

**Acceptance Criteria:**
- [ ] Each task execution creates a new feature branch (e.g., `quotaflow/task-{id}-{short-desc}`)
- [ ] Changes are committed to the feature branch with descriptive commit messages
- [ ] No push to remote -- commits stay local for human review
- [ ] No direct commits to main or any existing branch
- [ ] If task fails or produces no changes, branch is cleaned up

### Story 4: Quota Tracking and Estimation

**As a** subscriber
**I want to** QuotaFlow to track my token usage and estimate remaining quota
**So that** it can make smart dispatch decisions

**Acceptance Criteria:**
- [ ] Records token consumption per task execution (input + output tokens)
- [ ] Tracks 5-hour window boundaries and resets
- [ ] Tracks 7-day rolling consumption against weekly limit
- [ ] Estimates remaining quota with conservative buffer (don't run if <10% estimated remaining)
- [ ] Adjusts estimates based on rate limit responses from Claude CLI

### Story 5: Execution Reports and Notifications

**As a** developer
**I want to** see what QuotaFlow did while I was away
**So that** I can review results and plan my active session

**Acceptance Criteria:**
- [ ] Discord notification sent when each task completes (success/failure, branch name, summary)
- [ ] Local execution log with full details (tokens consumed, duration, output)
- [ ] Daily summary report: tasks completed, tokens used, quota remaining
- [ ] Weekly summary report: utilization rate, task completion rate, per-project breakdown

### Story 6: Concurrency Control

**As a** subscriber
**I want to** QuotaFlow to run multiple tasks in parallel when quota allows
**So that** throughput is maximized

**Acceptance Criteria:**
- [ ] Configurable max concurrency (default: 2)
- [ ] Concurrent sessions target different projects (never two sessions on same project)
- [ ] Concurrency scales down as quota depletes: high quota -> max concurrency, low quota -> serial
- [ ] Total concurrent sessions (manual + auto) respect subscription limits

---

## Functional Requirements

### Core Features

**Feature 1: Task Queue Manager**
- Central JSON file (`~/.quotaflow/tasks.json`) stores all queued tasks
- Task schema: `{ id, description, project, priority, size, safe, status, created_at }`
- Priority levels: high > medium > low
- Size estimates: small (~10K tokens), medium (~30K tokens), large (~60K tokens)
- Status lifecycle: queued -> running -> completed | failed | skipped
- CLI commands for queue management (add, list, remove, reprioritize) -- Phase 2

**Feature 2: Quota Monitor**
- Self-tracking based on recorded token consumption per session
- 5-hour window tracking: records window start time, cumulative usage, estimated remaining
- 7-day rolling tracking: cumulative weekly usage against estimated weekly cap
- Rate limit detection: if Claude CLI returns rate limit error, mark window as exhausted
- Conservative estimation: 10% safety buffer on all quota calculations
- Max 5x parameters: ~88K tokens/5h window, ~140-280 Sonnet compute hours/week

**Feature 3: Activity Detector**
- Checks for active Claude Code processes (`pgrep -f "claude"` excluding QuotaFlow's own sessions)
- Configurable inactivity threshold (default: 15 minutes since last active session)
- When user becomes active: gracefully finish current auto-task, then pause dispatch
- When user goes inactive: wait one full threshold period, then begin dispatch

**Feature 4: Task Executor**
- Executes tasks via `claude -p "{task_description}" --cwd {project_path} --print`
- Creates feature branch before execution, commits results after
- Captures stdout/stderr and token usage from CLI output
- Timeout per task based on size (small: 5min, medium: 15min, large: 45min)
- On failure: log error, mark task as failed, clean up branch, move to next task

**Feature 5: Notification System**
- Discord webhook for real-time task completion notifications
- Local log files in `~/.quotaflow/logs/`
- Daily digest: generated at configurable time (default: 8am local)
- Weekly digest: generated on configurable day (default: Monday 8am)

**Feature 6: Scheduler (Daemon)**
- Runs as a background process (launchd on macOS)
- Check cycle: every 5 minutes
- Decision flow per cycle: check activity -> check quota -> select task -> dispatch
- Graceful shutdown on SIGTERM
- Auto-restart on crash via launchd

### Out of Scope (v1)
- Web UI dashboard
- CLI task management commands (v1 uses direct JSON editing)
- Remote push of any kind
- Integration with OpenClaw
- Multi-machine or multi-subscription support
- Automatic task generation (user defines all tasks manually)
- Claude API quota endpoint (doesn't exist yet)

---

## Technical Constraints

### Performance
- Daemon memory footprint: <50MB resident
- Check cycle: 5-minute interval (not real-time, to minimize overhead)
- Task dispatch latency: <10 seconds from decision to Claude CLI invocation

### Security
- No remote network access except Discord webhook for notifications
- No credentials stored in task queue (Claude CLI uses existing auth)
- Feature branches only -- no writes to main, no push to remote
- Task descriptions sanitized to prevent command injection via claude -p

### Integration
- **Claude Code CLI**: Primary execution engine via `claude -p` headless mode
- **Git**: Branch creation, commits via standard git commands
- **Discord Webhook**: Outbound notifications only
- **launchd**: macOS daemon management
- **SQLite**: Usage tracking and execution history

### Technology Stack
- Runtime: Node.js (via nvm, per host environment policy)
- Language: TypeScript
- Database: SQLite (via better-sqlite3)
- Task Queue: JSON file (v1), SQLite (v2)
- Process Management: macOS launchd
- Notifications: Discord webhook API

---

## MVP Scope & Phasing

### Phase 1: MVP
1. **Quota Monitor** -- Self-tracking token usage, 5h window + 7-day rolling
2. **Task Queue** -- JSON file with manual editing, task schema validation
3. **Activity Detector** -- Process-based detection of active Claude sessions
4. **Task Executor** -- Single-task serial execution via claude CLI, feature branch commits
5. **Local Logging** -- Execution history, token consumption per task
6. **Discord Notifications** -- Per-task completion alerts

**MVP Definition**: A daemon that, when user is inactive, picks the highest-priority task from the queue, executes it in a feature branch, logs the result, and sends a Discord notification. Serial execution only.

### Phase 2: Enhancements
- Concurrent task execution (2-3 parallel sessions)
- CLI commands for task queue management (`quotaflow add/list/rm`)
- Daily and weekly digest reports
- Smarter size estimation based on historical task data
- Task templates for common operations (review, test, lint)

### Phase 3: Future Considerations
- Web dashboard for task management and usage visualization
- Integration with project-level TODO.md / CLAUDE.md scanning
- OpenClaw integration as execution backend
- Multi-subscription support
- Automatic task generation from GitHub issues
- Claude API quota endpoint integration (when available)

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| No public quota API -- usage estimation inaccurate | High | Medium | Conservative 10% buffer; rate limit detection as fallback; calibrate estimates over time |
| Anthropic changes rate limit behavior | Medium | High | Abstract quota model behind config; monitor Anthropic changelog; graceful degradation |
| Auto-tasks produce broken code | Medium | Medium | Feature branch isolation; no push; human review required; safe flag per task |
| Daemon interferes with manual sessions | Low | High | Activity detection with buffer; immediate pause on user activity; manual override |
| Claude CLI output format changes | Medium | Low | Parse loosely; version-pin CLI; test on upgrade |
| Discord webhook rate limiting | Low | Low | Batch notifications; retry with backoff |

---

## Dependencies & Blockers

**Dependencies:**
- Claude Code CLI installed and authenticated on host
- Node.js available via nvm
- Git configured for all target projects
- Discord webhook URL configured

**Known Blockers:**
- None currently. All dependencies are under user control.

---

## Appendix

### Glossary
- **5-hour window**: Rolling token quota period for Claude Max subscriptions
- **7-day rolling limit**: Weekly aggregate token/compute cap
- **Max 5x**: Claude Max plan at $100/month with ~5x Pro usage limits
- **Feature branch**: Git branch created by QuotaFlow for auto-executed task output
- **Headless mode**: Claude CLI's non-interactive `--print` mode

### Target Projects
- Any subdirectory under `projects_root` in config.json

### Configuration File Location
- `~/.quotaflow/config.json` -- daemon settings
- `~/.quotaflow/tasks.json` -- task queue
- `~/.quotaflow/logs/` -- execution logs
- `~/.quotaflow/data.db` -- SQLite usage tracking

---

*This PRD was created through interactive requirements gathering with quality scoring (91/100) to ensure comprehensive coverage of business, functional, UX, and technical dimensions.*
