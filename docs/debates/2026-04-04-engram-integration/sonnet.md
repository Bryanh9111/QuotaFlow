# Engram Integration Strategy - Pragmatic Engineer Position

**Date:** 2026-04-04
**Role:** Pragmatic Engineer
**Model:** claude-sonnet-4-6

---

## 1. Is the 3-tier decomposition correct?

The decomposition is mostly right but the ordering hides a critical seam. Tier 1 is not "zero changes" - it is a trust assumption. You are betting that every `claude -p` session spun by the executor will reliably connect to Engram MCP, recall relevant context, and write back useful memories without any verification path in QuotaFlow. That is an invisible dependency with no observability. Tier 1 ships fast, yes, but it ships a silent coupling.

The missing tier is Tier 0: structured log output. Before any Engram integration, QuotaFlow should be emitting task outcomes in a format that *could* be queried later - project, task id, success/failure, error message, duration, branch. It already does this partially through the logger and SQLite. This is not Engram integration, it is hygiene. Without it, Tier 2 and Tier 3 have nothing reliable to build on.

Tier 3 ordering is also suspect. Writing results back to Engram *after* task completion assumes the result is worth writing. A failed task with a misleading error message pollutes memory. You need a quality filter before Tier 3 ships.

## 2. Is "start with Tier 1 only" the right call?

Yes, with one adjustment: be explicit that it is a decision, not a default. Document it. If Engram MCP fails to load in a `claude -p` subprocess - wrong config, missing binary, env variable not propagated - the task runs with no memory context and QuotaFlow sees a success. That failure mode is invisible. Add a single line to the executor or post-task logging that checks whether the claude session reported any MCP connection errors in stderr. Do not block on it, just log it. That is 5 lines and it transforms Tier 1 from a blind hope into a monitored assumption.

Beyond that, yes - let both systems run independently. QuotaFlow has 129 tests but zero real-world executions. Engram is presumably similar. Coupling two unproven systems at the integration layer before either has production mileage is how you get bugs that are impossible to attribute.

## 3. Biggest risk

**Silent memory poisoning across projects.** QuotaFlow dispatches tasks concurrently across up to N projects. Each `claude -p` subprocess connects to the same Engram instance. Task A on project Relay writes a memory: "deploy pipeline is broken." Task B on project Athena, running in parallel, proactively recalls context about Relay because Engram's associative search finds a weak link between the two. Task B now operates under incorrect assumptions about Athena's state.

This is not hypothetical. Associative memory systems are designed to surface unexpected connections. That is their value. It is also their attack surface in a multi-project automation context. QuotaFlow's same-project exclusion logic (the `excludeProjects` set in scheduler) prevents concurrent same-project execution, but it does nothing to prevent cross-project memory bleed.

Mitigation: Engram memories written by automated QuotaFlow sessions should be tagged with `source: quotaflow` and `project: <name>`. Recall prompts in tasks should be scoped to project-relevant context. Neither of these is enforced today.

## 4. Strongest argument for Tier 2 NOW

The `pickNextExcluding` function in `queue.ts` already makes routing decisions based on token availability and project exclusion. It is making these decisions blind. If a project has a known blocker - failed CI, merge conflict, broken dependency - QuotaFlow will keep picking tasks for that project, executing them, burning quota, and getting failures that look like claude errors rather than project state errors.

Tier 2's value is not "smarter routing." It is "stop wasting quota on known-broken projects." That is a concrete, measurable benefit available today. The implementation is genuinely small: query Engram for each candidate project before dispatch, check for blockers, skip if found. The output of `execSync("engram search 'project:Relay blocker'")` is either empty or it is not. No complex parsing required.

The counterargument - "we don't know Engram is reliable yet" - applies equally to every other part of the system. Wrap it in a try/catch with a fallback to "proceed without Engram context." If Engram fails, behavior is identical to today. Risk is zero. Upside is real.

## 5. Controversial take

Tier 3 is the tier that actually matters, and nobody wants to build it because it requires answering an uncomfortable question: *what is a good task result?* Writing raw execution outcomes to Engram is noise. Writing curated, structured summaries requires either human review or a second Claude pass to synthesize results. Neither is in scope.

The real integration path is not QuotaFlow-writes-to-Engram. It is Engram-reads-from-QuotaFlow-logs. Engram should have a scheduled job that ingests the structured SQLite task history, extracts patterns - "project X fails 80% of the time on large tasks", "review tasks for Athena always produce diffs over 200 lines" - and surfaces these as first-class memories. This is an Engram feature, not a QuotaFlow feature. QuotaFlow should never be responsible for the quality of what gets remembered. That concern belongs in the memory system.

Trying to make QuotaFlow "memory-aware" is YAGNI. Make it emit clean, queryable structured data and let Engram own the memory lifecycle.
