# Debate 001 — QuotaFlow scope and identity

Date: 2026-04-30
Style: quick (1 round)
Participants: Codex (gpt-5.5 high), Gemini 2.5 Flash, Sonnet 4.6, Opus 4.7

## Background

Bryan's Zylo workspace has multiple personal-tool repos that follow Linus YAGNI + 10-year single-user companion pattern. Recent decisions established:

- **Engram** — zero-LLM memory store, HC-1 independence, HC-2 zero-LLM hot path. Has status lifecycle (active/obsolete) + origin trust tier (human/agent/compost) + 6 kinds.
- **Compost** — local-first knowledge fusion (SQLite + LanceDB), MIT fork-template, no central instance, has decision_audit/correction_events/triage/arbitration. Already at L3 (self-correction), targeting L5/L6.
- **ContextHub** — just archived 2026-04-30 because Compost + Claude Code on demand already covered the use case. Lesson: don't build a router until 5-8 manual artifacts exist.
- **claude-mem** — existing global MCP for session timeline + handoff observations.
- **claude-monitor** (Maciek-roboblog/Claude-Code-Usage-Monitor) — P90 percentile token-usage prediction CLI, plan auto-detect (Pro 44k / Max5 88k / Max20 220k). Decided to use as baseline.

## QuotaFlow original scope (suggestions.md, 2026-04-30)

> "Local daemon for Claude Max token quota allocation across projects" — narrow scope.

## QuotaFlow expanded scope (Bryan, this session)

> 本质上我需要一个智能好用的任务管理器（一个queue），我可以通过quotaflow这个入口给我本机内任意项目设置任务，并且在我不在的时候帮我完成，并且有完整的临时记忆（被采纳了才变成正式记忆），handoff的记忆（确保能无缝衔接），会给我详细的任务追踪和通知，会自动识别和计算出现在的usage量能否开始任务（claude和codex都支持）

Five components Bryan described:
1. Task queue across projects (single entry point)
2. Quota-aware dispatch (Claude + Codex usage)
3. Autonomous execution backend (runs while user away)
4. Two-tier memory (temp/staging → formal after user adoption) + handoff continuity
5. Detailed task tracking + push notifications

## The five boundary tensions (resolve these first)

1. **Temp vs formal memory** — Engram already has status lifecycle (active/obsolete) + origin trust tier. Is "temp memory promoted to formal on adoption" just `origin=agent + status=staging` in Engram, or does QuotaFlow really need its own store?
2. **Handoff memory** — claude-mem MCP already does session timeline + handoff observations. How much overlap? Should QuotaFlow consume claude-mem rather than rebuild?
3. **Quota detection** — claude-monitor already does P90 + plan auto-detect. Should QuotaFlow wrap it as subprocess, or reimplement?
4. **Multi-agent execution** — How does QuotaFlow drive Claude Code + Codex? Subprocess spawn? MCP integration? Hook injection? Each has different failure model.
5. **Cross-project entry point** — Genuinely new, no existing system covers this. But is it the queue UI, the worktree manager, or both?

## The five identity questions

1. **Autonomy boundary** — Auto commit? Auto push? Auto PR? Auto merge? Cost ceiling triggering pause?
2. **Failure handling** — When task fails/hangs/produces dangerous diff, notify and wait, or retry/rollback alone?
3. **Task input shape** — Natural language, formal spec, pre-written plan? Each has very different cost.
4. **Cross-project granularity** — One project at a time, or concurrent across projects? Latter requires worktree/lock/merge solution.
5. **Adoption mechanism** — Telegram/Discord push + one-tap review? Or terminal review on return? Affects entire UX surface.

## Constraints from Bryan's prior decisions

- HC-1 independence: any project must run without others installed
- Linus YAGNI: trigger-based building, do not speculate
- Single-user 10+ year personal tool, not a SaaS, not a business product
- Personal-tool fork-template distribution
- Recent ContextHub archive established: do not build a router until 5-8 manual artifacts exist

## What each participant must answer

A. **Identity verdict** — In one sentence, what is QuotaFlow? Pick one or specify subset:
   - (a) quota daemon
   - (b) autonomous task executor
   - (c) cross-project queue UI
   - (d) staging-memory layer
   - (e) some specific subset
   - (f) it should not be built yet

B. **Boundary verdict** — For each of the 5 tensions: reuse existing system / build new / split into separate project / defer.

C. **Smallest first slice** — If anything ships, what is v0.1 deliverable in 2 weeks of part-time work?

D. **Killer risk** — One thing that would make this entire effort wasted. (Bias-check: if you cannot name one, your verdict is suspect.)

E. **Verdict on whether to start** — Now / after Bryan lists 5 real tasks he would actually queue / not until specific trigger fires.

## Word limit

300 words per response. Be opinionated and specific.
