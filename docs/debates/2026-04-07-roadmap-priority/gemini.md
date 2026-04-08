# Gemini - The Systems Architect

From a systems architecture perspective, QuotaFlow is at a critical juncture. We've moved from basic dispatcher to quota-aware daemon, but the "Athena incident" — where a single project consumed 68% of the weekly quota — exposes a lack of **resource isolation**. We must shift focus from execution to **governance**.

### Top 3 for THIS WEEK

- **Execution History DB** — Cannot manage what we don't measure. SQLite store provides source of truth for trend analysis, enables scheduler to make historical-aware decisions.
- **Project Metadata + Per-Project Token Budget %** — Our answer to "Noisy Neighbor". Treats projects as first-class entities with resource constraints. Moves from global all-or-nothing to multi-tenant resource model.
- **Architecture Boundary Tests** — 133 tests covers function, not structure. Dependency linting prevents "Big Ball of Mud" as complexity grows.

### Top 3 for NEAR-TERM Roadmap

- **Agent Adapter Pattern** — Currently tightly coupled to Claude Code. Clean interface allows plugging in other CLIs without refactoring core scheduling.
- **Task Dependencies (DAG)** — Real workflows are rarely flat. DAG turns QuotaFlow into local orchestration engine, not just batch processor.
- **Weekly GC Scan** — Daemon must be self-healing. Routine to prune stale data, rotate logs, verify workspace integrity.

### Items to DROP

- **Web Dashboard** — A distraction. QuotaFlow is CLI-first. React frontend adds security vectors and maintenance overhead.
- **Client-Server Architecture** — Premature. Complicates local security model (auth, TLS) for a tool delivering value as zero-config local daemon.

### Missing Items

- **Cost Projection / Dry-Run Mode** — Simulation engine. Before dispatching a batch, show quota forecast based on estimated tokens.
- **Backpressure Signals** — Queue should signal "Saturation" to prevent queueing 1000 tasks that can't finish this cycle.

### Controversial Take: Weighted Fair Queuing over Static Budgets

Static per-project percentages are brittle — they lead to stranded capacity where one project's unused quota can't be leveraged by another.

The cleaner model is **Weighted Fair Queuing (WFQ)**. Assign weights to projects (Athena: 1, SideProject: 0.2). Scheduler allocates dynamically. If only one project has tasks, it gets 100%. If both have tasks, throttled by weight ratio. Maximum utility of quota while maintaining isolation.
