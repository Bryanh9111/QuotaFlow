# 5 Test Tasks for QuotaFlow Stress-Test

Date: 2026-05-01
Purpose: Throwaway tasks to validate the QuotaFlow workflow shape against existing Claude Code tooling. NOT real production work.

## Schema (per debate verdict)

Each task specifies:
- `id` — short slug
- `project` — exact path
- `agent` — claude / codex
- `actions_allowed` — what the agent may mutate
- `artifact` — expected output
- `review` — auto / require approval / staging
- `quota_tolerance` — max tokens budgeted

## Tasks

### T1 — Hello-world Python file

- project: `/tmp/qf-test-t1/`
- agent: claude
- actions_allowed: create files in /tmp/qf-test-t1 only
- artifact: `hello.py` printing "hello from QuotaFlow test"
- review: auto (throwaway)
- quota_tolerance: 5k tokens

### T2 — Generate one-line summary of recent commits

- project: `<workspace>/Compost`
- agent: claude
- actions_allowed: read-only git log; write summary to `/tmp/qf-test-t2-summary.txt`
- artifact: 5-line summary of last 10 commits
- review: auto (throwaway)
- quota_tolerance: 8k tokens

### T3 — Check .gitignore patterns across Zylo repos

- project: scan `<workspace>/{Engram,Compost,QuotaFlow}/.gitignore`
- agent: codex
- actions_allowed: read-only
- artifact: `/tmp/qf-test-t3-report.md` listing patterns shared and unique per repo
- review: auto (throwaway)
- quota_tolerance: 10k tokens

### T4 — Run a fixed grep across a repo, write count report

- project: `<workspace>/Engram`
- agent: claude
- actions_allowed: read-only ripgrep
- artifact: `/tmp/qf-test-t4-counts.txt` with count of `def ` per file in src/
- review: auto (throwaway)
- quota_tolerance: 5k tokens

### T5 — Create a typo-fix commit on a throwaway branch

- project: `/tmp/qf-test-t5/` (new git repo with one README.md containing "teh" instead of "the")
- agent: claude
- actions_allowed: read/write README.md, git commit, no push
- artifact: one commit fixing typo, branch `qf-test-t5`
- review: staging (don't auto-promote)
- quota_tolerance: 8k tokens

## Cluster analysis (per Codex verdict requirement)

Looking at the 5:

| Property | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|
| Read-only? | no (write) | mostly | yes | yes | no (write+commit) |
| Cross-project? | no | one | yes (3) | one | no |
| Needs git? | no | no | no | no | yes |
| Needs subprocess agent? | yes | yes | yes | yes | yes |
| Output goes to /tmp? | yes | yes | yes | yes | no (in repo) |

**Common pattern**: 4/5 are "spawn agent against project path, capture output to a file or stdout, no commit needed". Only T5 needs git mutation.

**Conclusion**: the queue's MVP needs to handle "submit a prompt + project path → spawn agent → capture artifact path → mark done". T5's commit-promotion path is the v0.2 staging-memory feature; should NOT be in v0.1.
