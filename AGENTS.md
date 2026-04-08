# AGENTS.md - QuotaFlow Task Scope Contract

> This file is injected into every `claude -p` invocation by QuotaFlow.
> It defines hard scoping constraints for autonomous task execution.
> Without these, a single "engineering plan" task consumed 908K tokens (15x the "large" estimate).

## Task Scope Contract

When executing a QuotaFlow-dispatched task, you MUST follow these rules:

### 1. Decompose Before Acting
Before making any changes, write out:
- What exactly will be delivered (1-2 sentences)
- What is explicitly OUT of scope (prevent creep)
- Expected file count: 1, 2-5, 6-10, or >10 (stop if >10 without approval)

### 2. Token Budget Discipline
Each task size has a target budget:
- **small** (~15K tokens): bug fix, 1-2 file changes, targeted review
- **medium** (~60K tokens): feature implementation, test writing, refactor 2-5 files
- **large** (~200K tokens): multi-file refactor, comprehensive analysis, 5-15 files
- **xlarge** (~800K tokens): engineering plans, full audits, multi-phase migrations

**If you estimate the task will exceed its budget, STOP and write a handover doc instead** explaining:
- What the task would require
- Why it exceeds the budget
- Suggested decomposition into smaller tasks

### 3. Hard Stop Conditions
Abort task execution if ANY of these become true:
- You've read more than 50 files (you're exploring, not executing)
- You're about to modify more than 15 files in one task
- The task has grown beyond its original scope
- You cannot determine a clear, deliverable unit of work

### 4. File Change Discipline
- **small**: 1-2 files modified
- **medium**: 2-5 files modified
- **large**: 5-15 files modified
- **xlarge**: Usually 1 doc (plan/audit report), not code

### 5. Output Requirements
Every task must produce one of:
- (a) Concrete code/doc changes on a feature branch (preferred)
- (b) A handover document explaining what's needed for the next session (if scope exceeds budget)
- (c) A clear "no-op" with explanation (if the task is already done)

Never return "I analyzed the codebase but didn't change anything" without an explicit handover doc.

### 6. Handover Document (Automatic)
For every task, also create `doc/handover-{task-id-short}.md` in the target project with:
- What was done
- Key decisions made
- Concrete next steps
- Known risks
- Files modified

This enables seamless context transfer between agent sessions.

## Why These Rules Exist

QuotaFlow runs tasks unattended during your idle time. Without scope discipline:
- Tasks balloon from "add validation" to "redesign the auth system"
- A single task can consume 30%+ of weekly quota
- Feature branches become unreviewable
- You wake up to find more work than you had before

The rules above are the difference between QuotaFlow being a productivity multiplier vs a quota destroyer.
