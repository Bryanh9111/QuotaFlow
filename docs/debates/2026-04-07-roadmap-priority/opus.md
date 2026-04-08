# Claude/Opus - The Realist

## Position: The data says the real problem is task sizing, not project budgeting. Stop building features. Start measuring.

### The one data point we have

**908K tokens for ONE engineering plan task, 6 minutes wall clock.** This is the only real-world data point QuotaFlow has. Before designing budgets, quotas, dashboards, or dependency graphs, we need to understand what that number means.

Breaking it down:
- A "large" task's token estimate was 60K. Actual consumption: **15x over**.
- Claude Code sessions use massive cache tokens (we saw cache_creation ~40K per probe call). The `input_tokens + cache_creation + cache_read + output` sum explodes for long-running tasks that read many files.
- The size estimator in `SIZE_TOKEN_ESTIMATES` is off by an order of magnitude.

**This invalidates most items on the list.** Per-project budgets (#6) assume we know how much a project will consume. We don't. Task dependencies (#7) assume we can predict cost. We can't. Weekly budget gating already works via real rate_limit_event data.

### Top 3 for THIS WEEK

**1. Calibration data collection (NOT on the list)** - The most valuable next task is running 10-20 small/medium/large tasks and recording actual consumption vs estimate. Without this, every size-based decision is guesswork. Turn the daemon into a measurement instrument before a production system.

**2. Item #2: Execution history DB** - Directly supports calibration. Store every task's estimate vs actual, per-size aggregates, running averages. This was already in the plan (Phase 2 smart estimation from historical data) but unused. Wire it in.

**3. Item #4: Enhanced daily digest** - Show the gap. "You estimated 60K, actual 908K. Recommend re-categorizing 'engineering plans' as XL." Surface the measurement problem to the user so he can make better task decisions.

### Top 3 for NEAR-TERM roadmap (next 2 weeks, after data collection)

**4. Item #6: Per-project budget, BUT with historical data** - After 2 weeks of collection, budgets can be set based on actual consumption patterns. Not blind percentages.

**5. Item #1: Agent adapter pattern** - Low cost, high option value. Doesn't need data to justify. Do it when touching executor anyway.

**6. New item: "XL" task size** - Add a 4th size tier (`xlarge` ~ 500K-1M tokens). Current `large` cap at 60K is wrong for long-running plans. This is a schema change, not a feature.

### Drop these entirely

- **#8 Client-server** - You have one laptop. Stop.
- **#9 Sub-agent orchestration** - Claude Code already does this internally. QuotaFlow doesn't need to reinvent it.
- **#10 Architecture boundary tests** - Premature for a 12-file project. Do it at >30 files.
- **#11 Weekly GC scan** - 31 tasks total, nothing to garbage collect. Do it at >500 tasks.

### Missing items I'd add

- **Real-time cost observability** - Daemon should log running token consumption during task execution (from stream-json events), not just final totals. the maintainer should be able to `tail -f` and see `[task-123] 450K tokens / 45% of budget` live.
- **Task kill switch** - If a task is burning more tokens than expected mid-execution, kill it. The 908K outlier could have been caught at 100K if there was a mid-execution budget check.
- **Weekly-aware task scheduling** - Right now daemon runs any task if quota >= size threshold. It should also consider "how many days until weekly reset" - run large tasks on Friday morning, small tasks late Thursday.

### Is per-project budget the right priority?

**No.** The root problem isn't "ProjectBeta ate the quota." It's "we had no idea ProjectBeta tasks cost 900K tokens." A budget caps *total consumption* but doesn't prevent the next surprise (e.g., a ProjectAlpha task accidentally costing 2M tokens because it read the entire codebase).

The real fix is **per-task budget ceilings with mid-execution kill** - "this task may consume up to X tokens; if it exceeds, terminate and mark as over-budget." That's harder to implement (requires interrupting stream-json mid-flight) but directly addresses the outlier problem.

Build the measurement first. Decisions without data are theater.
