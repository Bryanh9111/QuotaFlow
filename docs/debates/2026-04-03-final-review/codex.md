## 1. PRD Requirements Not Yet Implemented

- Story 1 is incomplete. The PRD requires a `safe` flag and clear rejection of malformed queue entries ([PRD Story 1](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L57), [Feature 1](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L138)). The shipped task schema has no `safe` field at all ([types.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/types.ts#L5)), and queue loading silently treats invalid JSON as an empty queue instead of surfacing an error ([queue.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/queue.ts#L29)). It also does not enforce “under the Zylo workspace”: `join(projectsRoot, input.project)` allows `../` traversal if that path exists ([queue.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/queue.ts#L55)).

- Story 2 / Feature 3 is only partially implemented. The PRD requires inactivity for `N` minutes and waiting a full threshold before dispatch ([PRD Story 2](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L69), [Feature 3](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L154)). `ActivityDetector` has `lastActiveTime`, but nothing in the scheduler updates it, so the daemon becomes eligible immediately once no `claude` process is present ([activity.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/activity.ts#L14), [scheduler.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/scheduler.ts#L71)).

- Story 4 and Story 5 are missing substantial pieces. Weekly quota is not tracked against a real weekly compute cap, and rate-limit responses do not adjust future estimates as required ([PRD Story 4](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L95), [quota.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/quota.ts#L157), [scheduler.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/scheduler.ts#L88)). Local logs do not include full output, daily digests omit quota remaining, and weekly digest/per-project breakdown are absent ([PRD Story 5](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L108), [logger.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/logger.ts#L14), [notify.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/notify.ts#L76), [scheduler.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/scheduler.ts#L205)).

- Story 6 is not fully implemented. Default concurrency is `1`, not `2` ([PRD Story 6](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L120), [types.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/types.ts#L55)). There is no manual+auto session limit accounting, and quota-based concurrency scaling is not robust.

## 2. Bugs or Issues in Current Code

- The project does not type-check cleanly: `TaskExecutor` expects `{ small, medium, large }`, but config supplies `{ small_minutes, medium_minutes, large_minutes }` ([index.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/index.ts#L43), [executor.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/executor.ts#L8)). At runtime this also breaks timeout enforcement because `timeouts[size]` becomes `undefined`.

- Scheduler deadlock risk: `busy` is cleared only after `checkDigests()` finishes ([scheduler.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/scheduler.ts#L59)). If digest sending throws, `busy` stays `true` and all future ticks are skipped permanently.

- Concurrency can overrun quota. Each slot rereads current availability without reserving tokens for already-selected tasks, and usage is recorded only after completion ([scheduler.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/scheduler.ts#L103), [scheduler.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/scheduler.ts#L186)). Two medium tasks can launch against one 40k window.

- Branch cleanup is unreliable on commit failure. If Claude changes files and `git commit` fails, cleanup does `git checkout` before deleting the branch; that checkout can fail on a dirty tree, leaving temp branches behind ([executor.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/executor.ts#L192)).

## 3. Real-World Usage Blockers

- Shipping as launchd is host-bound. Both the plist and launcher script hardcode `/Users/zion/Repos/Zylo/QuotaFlow` and assume `nvm` is present ([com.zylo.quotaflow.plist](/Users/zion/Repos/Zylo/QuotaFlow/com.zylo.quotaflow.plist#L7), [start-daemon.sh](/Users/zion/Repos/Zylo/QuotaFlow/scripts/start-daemon.sh#L5)).

- There is no preflight for required dependencies. Missing `claude`, missing auth, or missing Git identity only show up after a task is dequeued and failed, which is a poor “run tonight” experience ([executor.ts](/Users/zion/Repos/Zylo/QuotaFlow/src/executor.ts#L109), [docs/quotaflow-prd.md](/Users/zion/Repos/Zylo/QuotaFlow/docs/quotaflow-prd.md#L261)).

- I could not run Vitest end-to-end in this sandbox because Vite needs write access to `node_modules/.vite-temp`, but `npx tsc --noEmit` already fails independently, so the compile/runtime timeout bug is confirmed.