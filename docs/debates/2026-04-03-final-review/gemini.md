# Gemini - Systems Architect

## 1. PRD Requirements Not Yet Implemented

- **Continuous Concurrency (Story 6):** Batch-parallel mode -- waits for ALL concurrent tasks to finish before starting new ones. Doesn't fill slots as they become available.
- **In-Progress Activity Detection (Story 2):** Only checks activity at tick start. A 45-minute task won't be interrupted if user becomes active.
- **Comprehensive Reporting (Story 5):** Daily/weekly digest is skeletal -- lacks per-project breakdown, success rates, and detailed summaries.

## 2. Bugs or Issues

- **Activity Detection Self-Block:** pgrep detects QuotaFlow's own spawned claude processes as user activity. registerOwnPid registers the daemon PID but not child claude PIDs spawned by executor.
- **Git Branch Already Exists:** If a task is recovered from "running" state, `git checkout -b` fails because branch already exists. Should use `git checkout -B`.
- **Claude CLI --output-format json:** May not be supported. JSON.parse will consistently fail, defaulting to length/4 estimate.
- **Shell injection in claude command:** Uses string interpolation with single-quote escaping, but should use spawn with argv array (like git commit does).

## 3. Real-World Usage Blockers

- **Token usage extraction unreliable:** Without confirmed JSON output from claude CLI, quota tracking is speculative.
- **Zombie branches from failed tasks:** If claude leaves untracked files, subsequent tasks for that project fail the dirty-directory check.
- **Hardcoded default path:** DEFAULT_CONFIG points to /path/to/workspace, no setup wizard.
