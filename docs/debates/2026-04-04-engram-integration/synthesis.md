# Debate Synthesis: QuotaFlow + Engram Integration Strategy

**Date:** 2026-04-04
**Participants:** Opus (Realist), Sonnet (Pragmatist), Gemini (Architect), Codex (Devil's Advocate)

---

## The Core Disagreement

| Question | Opus | Sonnet | Gemini | Codex |
|----------|------|--------|--------|-------|
| Start Tier 1 only? | Yes | Yes | **No** - Tier 2 now | **No** - need observability first |
| Tier ordering correct? | **No** - swap 2 and 3 | Yes | Yes + add Tier 2.5 | **No** - need Tier 0 |
| Biggest risk | Stale recall poisoning | Engram downtime blocking dispatch | Hallucinated feedback loop | Shadow coupling without metrics |

## Key Insights by Debater

**Opus:** Tier 2 (query) is premature because Engram has nothing useful to return yet. Tier 3 (write-back) should come first to populate the knowledge base. The real value is Tier 3 for dashboarding, not Tier 2 for routing. QuotaFlow's routing should stay "dumb and mechanical."

**Sonnet:** Tier 1 is correct starting point. The execSync dependency in Tier 2 is a new failure mode -- if Engram hangs, QuotaFlow hangs. Need timeout + fallback. Agrees both systems need independent validation first.

**Gemini:** Tier 1 creates "invisible entropy" -- hidden dependency that changes behavior without code changes. Wants Tier 2 as a Circuit Breaker immediately. Most provocative take: QuotaFlow's task queue should eventually live IN Engram, making QuotaFlow a stateless worker.

**Codex:** Tier 1 isn't "zero changes" -- it's "shadow coupling with zero ownership." Wants a Tier 0: observability without dependency. Measure whether Engram's presence helps or hurts before assuming it does. "Accidental integrations are worse than designed ones."

## Consensus Points

1. **Stale/incorrect recall is the top risk.** All 4 agree Engram could poison automated tasks with outdated context. No one has a complete mitigation.

2. **execSync is dangerous for a daemon.** Tiers 2-3 via execSync blocks the event loop. Must be async with timeout or spawn-based.

3. **Both systems need real-world data first.** Even Gemini (who wants Tier 2 now) acknowledges validation gates are needed before trusting Engram's output for routing decisions.

## Verdict: Modified Tier 1

The debate revealed that "Tier 1 = zero risk" is a false assumption (Codex's strongest point). But "do Tier 2 now" is premature without data (Opus's strongest point).

### Recommended Path:

**Phase 1: Instrumented Tier 1 (this week)**
- Run QuotaFlow with Engram present (already works)
- Add simple logging: was Engram MCP connected? How many tokens used? Task success rate?
- Compare with/without by toggling Engram in MCP config
- No code changes to QuotaFlow itself

**Phase 2: Tier 3 Write-back (after 1 week of data)**
- QuotaFlow writes task outcomes to Engram (Opus's reordering)
- Populates Engram with structured task history
- ~20 lines of change

**Phase 3: Tier 2 Query (after 2+ weeks)**
- Now Engram has real data to query
- Pre-dispatch "circuit breaker" check with timeout
- Only if Phase 1 data shows Engram doesn't degrade task quality

## Debate Scores

| Debater | Specificity | Novelty | Actionability | Overall |
|---------|------------|---------|---------------|---------|
| **Codex** | 9/10 | 9/10 | 7/10 | **8.3** |
| **Gemini** | 8/10 | 9/10 | 7/10 | **8.0** |
| **Opus** | 8/10 | 8/10 | 9/10 | **8.3** |
| **Sonnet** | 8/10 | 6/10 | 8/10 | **7.3** |

**Co-winners: Opus + Codex** -- Opus for reordering tiers (write before read), Codex for exposing "shadow coupling" in Tier 1.

**Most valuable insight: Gemini's "Engram as Signal Layer"** -- long-term vision of QuotaFlow as stateless worker polling Engram for intents. Not actionable now, but architecturally compelling.
