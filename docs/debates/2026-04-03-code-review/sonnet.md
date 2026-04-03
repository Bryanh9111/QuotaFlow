# Code Review - QuotaFlow - 2026-04-03

**Reviewer:** Pragmatic Engineer (claude-sonnet-4-6)
**Verdict: SHIP** (with one tracked pre-merge fix)

---

## 1. Code Quality

Solid. The codebase is small, focused, and coherent. Each module has a single job. Dependency injection via the `SchedulerDeps` interface in `scheduler.ts` is the right call - it makes every collaborator mockable without a DI framework. The `deepMerge` in `config.ts` handles nested config correctly. `QuotaMonitor` using WAL-mode SQLite for local state is appropriate for a daemon.

Minor gripes (not blockers):

- `logger.ts:23-36` - the public methods accept `data?: unknown` but the internal `write()` signature also says `unknown`. The `SchedulerDeps.logger` interface in `scheduler.ts:33-37` constrains callers to `Record<string, unknown>`. Signature mismatch is harmless but inconsistent.
- `queue.ts:33` - `JSON.parse` on the queue file has no error handling. A corrupted `tasks.json` will crash the process on startup. Should be wrapped in try/catch like `loadConfig` does.
- `executor.ts:90` - `git checkout -b ${branchName}` still uses string interpolation into `execAsync`. Branch names are generated internally via `buildBranchName` (controlled output), so the injection surface is low - but it is inconsistent with the `spawnAsync` approach used for the commit message at line 187. Not a blocker, but worth noting.

## 2. Test Coverage

Comprehensive for the surface area. Every module has a corresponding test file. Key paths covered:

- `quota.test.ts` - window reset, rate-limit flag, persistence across close/reopen, floor-at-zero. All critical.
- `scheduler.test.ts` - re-entrancy guard (busy flag), full success path, failure path, rate-limit detection from both thrown errors and failure results.
- `executor.test.ts` - dirty working tree guard, branch cleanup on CLI failure, branch name truncation.
- `queue.test.ts` - priority sort, `pickNext` token gating, crash recovery, persistence.

Gaps worth tracking (not blockers):

- `queue.ts:33` corrupt JSON path is untested (matches the missing error handling gap above).
- `executor.ts` has no test for the "claude succeeds but produces no file changes" path (the `!hasDiff` branch at line 165). That path returns `success: true` with empty branch - a subtle behavior that callers should know is tested.
- `notify.ts` - `post()` does not check the HTTP response status. A non-2xx Discord response is silently swallowed. Not a crash risk, just a silent failure. No test covers it.

## 3. Security

No serious issues. The commit message uses `spawnAsync` with args array (`executor.ts:187-190`), which is correct and injection-safe. The description is not passed through shell expansion.

The claude command itself (`buildClaudeCommand`, `executor.ts:25-28`) uses single-quote shell escaping (`'\\''`) which is the standard POSIX approach. It is correct for descriptions that contain single quotes. However, the `--cwd` value is `projectPath` which comes from `join(config.projects_root, task.project)`. Both values are controlled by the operator's config, so the practical risk is minimal.

No secrets in source. `discord_webhook_url` defaults to `""` in `types.ts:60` and is gated before every use.

## 4. Blockers

One item needs fixing before commit:

**`queue.ts:33` - unguarded `JSON.parse`**. If `tasks.json` is corrupted (partial write, manual edit, disk full), the process will throw an unhandled exception on any queue read, taking down the daemon. The fix is two lines - wrap in try/catch and return `{ tasks: [] }` on parse failure, identical to how `loadConfig` handles it.

Everything else is a quality improvement, not a correctness issue.

---

## Summary

The architecture is clean, the test suite covers the critical paths (quota math, scheduler state machine, executor git hygiene), and there are no security red flags. The single blocker is a straightforward defensive guard on queue file parsing. Fix that, and this ships.

**SHIP** after fixing `queue.ts:33`.
