# Claude/Opus - The Realist

## Position: Tier 1 is correct, but Tier 2 is backwards. Tier 3 should come before Tier 2.

### 1. Is the 3-tier decomposition correct?

The tiers are logical but the ordering of 2 and 3 is wrong.

**Tier 1 (passive)** is correctly placed first. It's literally zero work and provides immediate value. Every claude -p session already benefits from Engram's proactive recall. The key insight: this already works today because MCP is a global config, not a per-tool integration.

**Tier 3 should be Tier 2.** Writing results back ("task-42 fixed auth bug in ProjectAlpha") is more valuable than querying before dispatch. Why: without Tier 3 data, Tier 2 has nothing useful to query. What would `engram search "ProjectAlpha blockers"` return? Only whatever the user manually wrote. But after a week of QuotaFlow running with Tier 3, Engram has a rich history of what was tried, what worked, what failed. THEN Tier 2 queries become powerful.

**Corrected ordering:**
- Tier 1: Passive (zero changes) -- sessions auto-connect
- Tier 2: Write-back (medium) -- QuotaFlow writes results to Engram
- Tier 3: Query-before-dispatch (small) -- QuotaFlow reads Engram for routing

### 2. Is "start with Tier 1 only" the right call?

**Yes, absolutely.** Both QuotaFlow and Engram have zero real-world runtime. Coupling two untested systems is the fastest way to debug nightmares where you can't tell which system caused the failure.

More importantly: Tier 1 gives you data. When those claude -p sessions run and Engram auto-remembers, you'll see what kind of memories get created organically. That informs whether Tier 2/3's explicit writes would even be useful or just noisy duplicates.

### 3. Biggest risk

**Engram proactive recall poisoning automated tasks.** Tier 1 isn't truly "zero risk" even though it's zero changes. If Engram's proactive recall injects incorrect or outdated context into a QuotaFlow-dispatched session, it could make tasks fail that would otherwise succeed. Example: Engram recalls "ProjectAlpha's auth uses JWT" from 3 months ago, but ProjectAlpha switched to session cookies. Claude uses the stale recall and writes wrong code.

The mitigation is Engram's own confidence/freshness scoring, but that needs real-world validation too -- another reason to run Tier 1 in observation mode first.

### 4. Strongest argument for doing Tier 2 NOW

There isn't one. The proposal's Tier 2 (query before dispatch) is a premature optimization on an empty knowledge base. `execSync("engram search ...")` will return nothing useful until Engram has been populated with project-specific knowledge through actual usage.

The strongest argument for doing the REAL Tier 2 (write-back) now is: QuotaFlow will run tasks tonight and the results will be lost to Engram. Without write-back, the only memory path is through claude -p sessions' own auto-remember, which may or may not capture the task-level metadata (task ID, success/failure, branch name) that makes future routing useful.

But "strongest argument" ≠ "should do it now." Wait for Tier 1 data first.

### 5. Controversial take

**Tier 2 (querying Engram for routing) will never be worth the complexity.** The value proposition is "skip ProjectAlpha tasks if deploy is broken." But QuotaFlow already handles this: if a task fails, it's marked as failed and the daemon moves on. The rate limit detection catches quota issues. The retry logic handles transient failures. Adding an Engram pre-check adds a synchronous blocking call, a new failure mode (what if Engram is down?), and marginal decision quality improvement at best.

The real integration value is Tier 3 only: building a shared memory of "what has QuotaFlow done across all projects." That's a dashboarding/reporting play, not a routing play. QuotaFlow's routing should stay dumb and mechanical (priority + quota + size). The intelligence should live in the Claude sessions themselves, where Engram already provides it via Tier 1.
