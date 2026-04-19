# QuotaFlow Roadmap

Updated: 2026-04-18 (Telegram bidirectional shipped)

## Completed

### P1 (MVP)
- [x] 5h session quota tracking (SQLite)
- [x] Task queue with priority + size
- [x] Activity detection (filters background claude processes)
- [x] Git branch isolation + cleanup
- [x] Discord webhook notifications
- [x] CLI subcommands (add/list/rm/status/template)
- [x] Dry-run mode

### P2 (Enhanced)
- [x] Dual-layer quota awareness (session + weekly) from `rate_limit_event`
- [x] Task size gating (size vs utilization %)
- [x] Pre-dispatch quota probe (prevents overage)
- [x] Concurrent task dispatch (same-project exclusion)
- [x] Task templates (review/test/lint/docs/refactor)
- [x] Daily/weekly digest scheduling
- [x] Auto handover doc per task
- [x] Security hardened (spawn+argv, path traversal check)

### P2.5 (Scope Control) -- 2026-04-07
- [x] AGENTS.md task scope contract injected into every prompt
- [x] `usage_log.project` column for per-project analysis
- [x] `getUsageByProject()` + `getOutliers()` queries
- [x] Enhanced digest: per-project breakdown + outlier detection
- [x] `xlarge` task size tier (800K tokens target)
- [x] Recalibrated SIZE_TOKEN_ESTIMATES from real data (small=15K, medium=60K, large=200K)
- [x] Bug fix: `recordUsage` now passes `size` and `project` from scheduler

### P3 (Telegram + Multi-workspace) -- 2026-04-18
Driven by user need: phone-first task capture during idle time, across multiple workspaces.

**Telegram outbound (notifications)**:
- [x] `TelegramNotifier` class with MarkdownV2 escape helper
- [x] Per-task completion push + daily/weekly digest on Telegram
- [x] Discord kept as fallback channel (config selects one)

**Telegram inbound (enqueue)**:
- [x] `TelegramPoller` with 30s long-polling, try/catch-isolated from scheduler
- [x] Three-layer auth: chat_id whitelist + passphrase prefix + `message_id` dedup
- [x] State persisted to `~/.quotaflow/telegram.state.json` (not SQLite, avoids write contention)
- [x] Commands: `@Project desc`, `/add proj= size= pri=`, `/list`, `/list-projects`, `/status`, `/rm`, `/help`
- [x] Four-way AI debate recorded in `docs/debates/2026-04-18-telegram-inbound/`

**Multi-workspace support**:
- [x] `projects_roots: string[]` (legacy `projects_root` merged in, backward-compatible)
- [x] `project-resolver.ts` with exact → ci-exact → prefix → substring → absolute matching
- [x] Ambiguous matches return candidate list; earlier roots win on duplicates
- [x] `default_project` dropped (user explicitly rejected; `@Name` shortcut + fuzzy match replace it)

## Week 2 (if needed, trigger-based)

### Observability
- [ ] Per-task token kill switch (abort task if >N tokens mid-execution)
- [ ] Task age/staleness in CLI `list` command
- [ ] Real-time token consumption logging during execution
- [ ] `--reserve-pct` flag for manual quota reservation

### Task Hygiene
- [ ] Weekly GC scan (archive old tasks, clean orphan branches) -- **trigger: >500 tasks**
- [ ] Stale task detection in CLI

## Permanently Dropped (debate consensus)

- ~~Web dashboard (React)~~ -- 4/4 debaters: Discord digest IS the dashboard
- ~~Client-server architecture~~ -- 4/4 debaters: single machine, stop
- ~~Sub-agent orchestration~~ -- 3/4: dangerous with uncalibrated sizing
- ~~Task dependencies (depends_on)~~ -- 3/4: no real use case
- ~~Per-project budget %~~ -- Codex: "fairness theater, builds on fake units"
- ~~Architecture boundary tests~~ -- premature for 12-file project

## Roadmap (trigger-based, not time-based)

### When a 2nd Claude CLI alternative exists
- [ ] Agent adapter pattern (abstract executor behind interface)

### When codebase exceeds 30 files
- [ ] Architecture boundary tests

### When the user explicitly asks
- [ ] Web dashboard
- [ ] Multi-subscription support

### When multi-machine is actually needed
- [ ] Client-server split

## Principles Learned

1. **Measure before building features** -- 908K outlier falsified sizing model. Without historical data, budget logic is fiction.
2. **Scope control > resource policy** -- AGENTS.md in prompt is more effective than budget caps.
3. **Real API data > self-tracking** -- `rate_limit_event.utilization` is authoritative; internal counters drift.
4. **Task size is prompt discipline, not config** -- enforce via SCOPE_CONTRACT, not token ceilings alone.
5. **Handover docs enable context transfer** -- every task produces one, next session picks up seamlessly.
