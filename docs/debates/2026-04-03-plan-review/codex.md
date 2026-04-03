# Codex - The Devil's Advocate

My position: this MVP is overconfident, under-specified, and structurally more brittle than the PRD admits. It reads like a productivity multiplier, but the implementation plan is really a thin automation shell around undocumented CLI behavior, weak process detection, and guessed quota math.

## 1. Architecture Verdict

The architecture is not a reliable daemon; it is a polling script with persistence glued on. The PRD promises "near-100% token utilization" and "zero interference with manual sessions", but the plan's actual loop is just activity check -> quota check -> pick task -> execute every five minutes. That is not enough control for a rolling-window quota system. Worse, state is split across JSON for tasks and SQLite for usage, so there is no atomic notion of "task claimed, run started, quota reserved." A crash between task status update and quota recording leaves ambiguous truth.

## 2. Tech Stack Critique

The stack choices are inconsistent and fragile. The plan says Node.js 24, but package.json only requires >=20, while launchd hardcodes an npx tsx path under a specific nvm install. Running a long-lived daemon through npx tsx is a development convenience, not an operational choice. `main: "src/index.ts"` further proves this is not being packaged like software expected to survive upgrades and restarts. Also, the tests are mostly mocked unit tests; they will certify shape, not behavior.

## 3. Biggest Risk

The quota model is fiction. The PRD itself admits there is no public quota API, but the implementation still treats the five-hour window like a local counter and the weekly limit like a reporting field. QuotaMonitor.getAvailableTokens() only subtracts self-recorded usage, and Scheduler never gates on weekly compute usage at all. If the core resource governor is wrong, everything else is ceremony around accidental overuse.

## 4. What Is Missing

The plan leaves out exactly the controls that make unattended code execution survivable. The safe flag exists in the task schema but nothing uses it. There is no repo cleanliness check before branch creation, no requeue/recovery strategy for running tasks after crash, no schema validation for manually edited JSON beyond "parse and hope," no manual pause/override despite the PRD naming one as mitigation, and no real exclusion of QuotaFlow's own Claude processes because registerOwnPid() exists but is never wired from executor or index.

## 5. Strongest Part

The strongest design choice is branch isolation. The PRD is correct to insist on feature branches and no push, and the executor does at least try to enforce that by creating a task branch, committing only when there is an actual diff, and deleting empty branches. That is the one place where the implementation meaningfully reduces blast radius.

## 6. Controversial Take

This should not be a daemon in v1. The daemon model is an attractive nuisance. A safer product would be an explicit "overnight batch runner" that wakes once, consumes one task, records outcome, and exits. That would force idempotency, reduce split-brain state, avoid long-lived npx tsx nonsense, and expose quota uncertainty instead of pretending it is solved. Right now, the plan is trying to automate unattended software changes before it has earned the right to automate unattended process control.
