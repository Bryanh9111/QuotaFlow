# Stress-Test Results — Existing Tooling Coverage

Date: 2026-05-01
Tasks attempted: T1 (codex hello.py), T2 (claude git-log summary)
Result: **Both completed end-to-end with ZERO new infrastructure.**

## T1 — codex exec --full-auto

```bash
codex exec --full-auto "Create the file /tmp/qf-test-t1/hello.py containing exactly: print('hello from QuotaFlow test')\nThen confirm by reading it back. Do not modify any other files."
```

- ✅ File created at /tmp/qf-test-t1/hello.py
- ✅ Content correct
- ✅ No side effects outside target
- ⚠️ Token cost: 32,413 (heavy for one-line file — gpt-5.5 high reasoning + read-back)

## T2 — claude -p with proper flags

```bash
echo "Read git log of <workspace>/Compost (last 10 commits) and write a 5-line summary to /tmp/qf-test-t2-summary.txt. Do nothing else." \
  | claude -p \
      --dangerously-skip-permissions \
      --add-dir /tmp \
      --add-dir <workspace>/Compost \
      --max-budget-usd 0.50
```

- ✅ Summary written to /tmp/qf-test-t2-summary.txt
- ✅ Exactly 5 lines as requested
- ✅ Correctly scoped to Compost repo
- ✅ Stayed under budget

## Decisive finding

`claude -p` and `codex exec` already provide every v0.1 primitive QuotaFlow was meant to add:

| Capability | Claude Code CLI flag | Codex CLI flag | QuotaFlow needed? |
|---|---|---|---|
| Headless one-shot dispatch | `-p` / `--print` | `exec` | ❌ already there |
| Per-run cost ceiling | `--max-budget-usd <n>` | (config token budget) | ❌ already there |
| Permission scoping | `--add-dir` + `--dangerously-skip-permissions` | `--full-auto` workspace-write | ❌ already there |
| Model selection | `--model <name>` | `<codex-config-dir>/config.toml` | ❌ already there |
| Effort tier | `--effort low\|medium\|high\|xhigh\|max` | `model_reasoning_effort` | ❌ already there |
| Output format | `--output-format json\|stream-json` | (text default) | ❌ already there |
| MCP injection | `--mcp-config` | (built-in) | ❌ already there |
| JSON schema validation | `--json-schema` | (none) | ⚠️ claude only |
| Working dir scoping | `--add-dir` (multiple) | `workdir` arg | ❌ already there |

## What is still genuinely missing

QuotaFlow's only real value-add over `claude -p` + shell is:

1. **Persistent queue** — survives shell session / machine reboot. `claude -p` is fire-and-forget.
2. **Sequential dispatch daemon** — runs queued tasks one at a time when quota permits. Could be ~50 LoC `while` loop + SQLite.
3. **Pre-dispatch global-quota gate** — check claude-monitor before launching, hold task until budget recovers. `--max-budget-usd` is per-run, not session/daily-aware.
4. **Cross-project status board** — `qf list` showing what's queued, running, done across projects.
5. **Telegram/Discord push on completion** — claude -p exits silently.

That's it. Five small features.

## Revised verdict (post-stress-test)

**QuotaFlow is NOT a project. It's a 200-line shell or Python wrapper around `claude -p` + `codex exec`.**

Specifically: a single Python file (or bash script) named `qf` that:

```
qf submit <project_path> --agent claude|codex --prompt "<text>" --budget-usd 0.5 [--branch <name>]
   → INSERT into ~/.qf/queue.db (status=queued)

qf daemon
   → loop: SELECT next queued task → check claude-monitor JSON → if budget OK,
     spawn `claude -p --add-dir <project> --max-budget-usd <budget> ...` or
     `codex exec --full-auto ...` → capture stdout to log → mark done/failed →
     osascript notification → loop

qf list / qf logs <id> / qf cancel <id>
   → trivial SQLite reads
```

**Estimated: 200 LoC, 1-2 days of work, no daemon framework, no MCP, no React UI, no separate repo even necessary.**

## Recommendation update vs original debate synthesis

The debate synthesis said "if both gates pass, ship v0.1 (Opus level)". This stress-test result tightens that further:

- **Skip the daemon framework**. Use a plain Python `while` loop with `time.sleep(30)`.
- **Skip a new repo**. The `qf` script can live as a single file in `~/bin/qf` or in any existing utility repo.
- **The "QuotaFlow" project name is misleading** — this is `qf` shell wrapper, not a system. Consider just naming it that.
- **Build trigger**: Bryan must encounter the missing-feature pain (persistent queue, cross-project status, push notification) at least 3 times in real work before writing the wrapper. If 3 instances don't happen in 2 weeks, the need was speculative.

## Killer-risk verdict (revised)

The Opus killer risk from the debate ("Bryan re-discovers /loop + /schedule") was *partially* wrong — the real coverage comes from `claude -p` itself, not the in-session skills. But the conclusion is the same: building a "QuotaFlow daemon" before exhausting `claude -p` + shell scripts is reinventing the CLI.
