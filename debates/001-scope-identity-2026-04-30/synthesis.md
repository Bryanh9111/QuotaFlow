# Debate 001 Synthesis — QuotaFlow scope and identity

Date: 2026-04-30
Participants: Codex (gpt-5.5 high), Gemini 2.5 Flash, Sonnet 4.6, Opus 4.7
Verdict basis: 4-way single round, all responded, all in scope.

---

## Consensus (4/4 agree)

| Topic | Verdict |
|---|---|
| Whether to start now | **No.** Wait for Bryan to list 5 real tasks with full shape. |
| Killer risk anchor | Repeating ContextHub — building speculative infra before concrete recurring use cases exist. |
| Engram for staging memory | **Reuse** with `origin=agent + status=staging`; promote to `active` on user adoption. No new memory store. |
| claude-mem for handoff | **Reuse**; consume claude-mem MCP, do not rebuild timeline/handoff. |
| claude-monitor for quota | **Wrap as subprocess.** Do not reimplement P90/plan-detect. |
| Multi-agent execution path | **Subprocess spawn only** for v0.1; no MCP/hook injection. |
| Cross-project entry point | **Build the queue** (this is the only genuine new gap). |

## Strong-majority (3/4 or split)

| Topic | Position | Dissent |
|---|---|---|
| Identity label | Quota-gated dispatcher / minimal dispatch engine (Codex, Gemini, Opus) | Sonnet calls it "autonomous task executor" but its v0.1 is identical — terminology only |
| Worktree concurrency | **Defer** (Codex, Sonnet, Opus) | Gemini does not address |
| v0.1 includes notifications | macOS terminal alert (Sonnet, Opus) vs Telegram/Discord push (Codex) vs simulate-only print (Gemini) | Sonnet+Opus win on YAGNI; Telegram/Discord is v0.2 |

## Disagreements worth surfacing

1. **v0.1 ambition gradient**:
   - Gemini: simulate dispatch (print "would run X") — validates routing logic only
   - Opus: real subprocess + log capture, but no Engram/claude-mem write-back yet
   - Sonnet: real subprocess + Engram staging write on completion
   - Codex: real subprocess + Telegram/Discord + cost ceiling check
   - **Bryan's call.** The gradient is essentially "how much do you trust your design before writing it". Recommendation: start at Opus level (real but log-only), add Engram staging in v0.2 once queue is proven.

2. **Killer risk emphasis**:
   - Codex / Gemini / Sonnet: ContextHub-style premature build
   - Sonnet adds: mid-execution quota exhaustion → bad diff (real, mitigated by worktree + clean-tree precondition)
   - **Opus surfaces a unique killer**: Bryan re-discovers `/loop` + `/schedule` + ScheduleWakeup already cover 80% of need; QuotaFlow becomes a reimplementation of Anthropic features. **This is the strongest pre-build test** — it didn't appear in the other three.

## Final recommendation

Bryan should **not start coding QuotaFlow now**. Instead, two prerequisites:

### Prerequisite 1: Concrete task inventory (30 minutes)
Write 5 real tasks Bryan would actually queue. Each task must specify:
- Exact project path
- Intended agent (Claude or Codex)
- Allowed actions (commit? push? PR? merge?)
- Expected artifact (file diff / PR / report)
- Review rule (auto / require approval / staging memory)
- Quota tolerance (max tokens before pause)

### Prerequisite 2: Stress-test against existing tools (1 hour)
For 2 of the 5 tasks, attempt them with **existing infrastructure**:
- Claude Code `/loop <interval> <prompt>`
- Claude Code `/schedule` (cron-driven remote agents)
- `ScheduleWakeup` for self-paced loops
- `claude-monitor` for quota visibility
- `gh pr create` + manual `claude` invocation

Report back what specifically broke or fell short. If 4 of 5 tasks are doable with existing tools + minor shell scripts, **archive QuotaFlow** before it's written. If at least 3 of 5 require non-trivial new infrastructure (queue persistence across machine reboot, cross-project handoff, quota-blocking behavior), proceed.

### If both gates pass, v0.1 scope (Opus level, debate-aligned)

```
~/.quotaflow/
  queue.db           SQLite: {id, project_path, agent, prompt_file, branch, cost_ceiling, status, started_at, finished_at}
  runs/<id>.log      stdout/stderr capture per run
  daemon.pid         single-instance lock

CLI:
  qf submit <project_path> --agent claude|codex --prompt-file <f> --branch <name> --cost-ceiling <n>
  qf list [--status running|done|failed|queued]
  qf cancel <id>
  qf logs <id>

Daemon:
  - poll every 30s
  - claude-monitor --json budget gate
  - one concurrent task max
  - subprocess in target project_path worktree
  - macOS osascript notify on done/failed/budget-exhausted
  - precondition: target branch exists, working tree clean, in worktree

Out of v0.1:
  - auto-commit (manual review only)
  - Telegram/Discord push (v0.2)
  - Engram staging write (v0.2)
  - claude-mem handoff write (v0.2)
  - Concurrent runs (v0.3, only if real demand)
  - MCP/hook execution path (v0.3, only if subprocess fails to deliver)
```

### Pinned decision to record

If user agrees to wait-for-tasks: pin a global Engram memory (project=quotaflow) capturing this verdict so future sessions don't restart the discussion.

---

## Round files

- `rounds/r001_codex.md` — Codex (gpt-5.5)
- `rounds/r001_gemini.md` — Gemini 2.5 Flash
- `rounds/r001_sonnet.md` — Sonnet 4.6
- `rounds/r001_opus.md` — Opus 4.7

## Cost note

- Codex: 31,910 tokens (high reasoning effort)
- Gemini: 1 retry due to workspace path restriction (resolved by inlining context)
- Sonnet: ~19k tokens (Agent dispatch)
- Opus: this session
