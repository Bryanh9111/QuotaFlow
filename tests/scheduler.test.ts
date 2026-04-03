import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler } from "../src/scheduler.js";
import type { Config, Task, ExecutionResult } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    description: "test task",
    project: "TestProject",
    priority: "medium",
    size: "small",
    status: "queued",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    task_id: "task-1",
    success: true,
    branch: "quotaflow/task-1",
    tokens_used: 5000,
    duration_ms: 3000,
    stdout: "done",
    stderr: "",
    ...overrides,
  };
}

function mockDeps() {
  return {
    config: { ...DEFAULT_CONFIG } as Config,
    activity: {
      isUserActive: vi.fn<[], Promise<boolean>>().mockResolvedValue(false),
      registerOwnPid: vi.fn<[number], void>(),
    },
    quota: {
      getAvailableTokens: vi.fn<[], number>().mockReturnValue(20000),
      recordUsage: vi.fn<[string, number, number], void>(),
      markRateLimited: vi.fn<[], void>(),
      isWindowExhausted: vi.fn<[], boolean>().mockReturnValue(false),
      getWeeklyUsage: vi.fn().mockReturnValue({ total_tokens: 0, total_duration_ms: 0, task_count: 0 }),
    },
    queue: {
      pickNext: vi.fn<[number], Task | null>().mockReturnValue(makeTask()),
      updateTask: vi.fn<[string, Partial<Task>], void>(),
      completeTask: vi.fn<[string, { branch: string; tokens_used: number; duration_ms: number }], void>(),
      failTask: vi.fn<[string, string], void>(),
      recoverRunningTasks: vi.fn<[], number>().mockReturnValue(0),
      getAll: vi.fn().mockReturnValue([]),
    },
    executor: {
      execute: vi.fn<[Task, string], Promise<ExecutionResult>>().mockResolvedValue(makeResult()),
    },
    notifier: {
      taskCompleted: vi.fn<[Task, ExecutionResult], Promise<void>>().mockResolvedValue(undefined),
      sendMessage: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
      sendDailyDigest: vi.fn().mockResolvedValue(undefined),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
}

describe("Scheduler", () => {
  let deps: ReturnType<typeof mockDeps>;
  let scheduler: Scheduler;

  beforeEach(() => {
    deps = mockDeps();
    scheduler = new Scheduler(deps);
  });

  it("skips when user active", async () => {
    deps.activity.isUserActive.mockResolvedValue(true);
    await scheduler.tick();
    expect(deps.quota.isWindowExhausted).not.toHaveBeenCalled();
    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("skips when window exhausted", async () => {
    deps.quota.isWindowExhausted.mockReturnValue(true);
    await scheduler.tick();
    expect(deps.quota.getAvailableTokens).not.toHaveBeenCalled();
    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("skips when no quota", async () => {
    deps.quota.getAvailableTokens.mockReturnValue(0);
    await scheduler.tick();
    expect(deps.queue.pickNext).not.toHaveBeenCalled();
    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("skips when no tasks", async () => {
    deps.queue.pickNext.mockReturnValue(null);
    await scheduler.tick();
    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("executes task and chains the full success path", async () => {
    const task = makeTask();
    const result = makeResult();
    deps.queue.pickNext.mockReturnValue(task);
    deps.executor.execute.mockResolvedValue(result);

    await scheduler.tick();

    // updateTask -> running
    expect(deps.queue.updateTask).toHaveBeenCalledWith(task.id, { status: "running" });

    // executor called with correct path
    const { join } = await import("node:path");
    const expectedPath = join(deps.config.projects_root, task.project);
    expect(deps.executor.execute).toHaveBeenCalledWith(task, expectedPath);

    // completeTask
    expect(deps.queue.completeTask).toHaveBeenCalledWith(task.id, {
      branch: result.branch,
      tokens_used: result.tokens_used,
      duration_ms: result.duration_ms,
    });

    // recordUsage
    expect(deps.quota.recordUsage).toHaveBeenCalledWith(task.id, result.tokens_used, result.duration_ms);

    // notify
    expect(deps.notifier.taskCompleted).toHaveBeenCalledWith(task, result);

    // no failure path
    expect(deps.queue.failTask).not.toHaveBeenCalled();
  });

  it("handles task failure: calls failTask and notifier", async () => {
    const task = makeTask();
    const result = makeResult({ success: false, error: "something broke", stderr: "oops" });
    deps.queue.pickNext.mockReturnValue(task);
    deps.executor.execute.mockResolvedValue(result);

    await scheduler.tick();

    expect(deps.queue.failTask).toHaveBeenCalledWith(task.id, "something broke");
    expect(deps.notifier.taskCompleted).toHaveBeenCalledWith(task, result);
    expect(deps.queue.completeTask).not.toHaveBeenCalled();
    expect(deps.quota.recordUsage).not.toHaveBeenCalled();
  });

  it("marks rate limited when failure error contains 'rate limit'", async () => {
    const task = makeTask();
    const result = makeResult({ success: false, error: "rate limit exceeded" });
    deps.queue.pickNext.mockReturnValue(task);
    deps.executor.execute.mockResolvedValue(result);

    await scheduler.tick();

    expect(deps.quota.markRateLimited).toHaveBeenCalled();
  });

  it("marks rate limited when executor throws with 'rate limit' in message", async () => {
    const task = makeTask();
    deps.queue.pickNext.mockReturnValue(task);
    deps.executor.execute.mockRejectedValue(new Error("API rate limit hit"));

    await scheduler.tick();

    expect(deps.queue.failTask).toHaveBeenCalledWith(task.id, "API rate limit hit");
    expect(deps.quota.markRateLimited).toHaveBeenCalled();
    expect(deps.notifier.taskCompleted).toHaveBeenCalled();
  });

  it("P0: skips tick when previous still running (re-entrancy guard)", async () => {
    // Make executor hang until we resolve it
    let resolveExec!: (r: ExecutionResult) => void;
    const hangPromise = new Promise<ExecutionResult>((res) => { resolveExec = res; });
    deps.executor.execute.mockReturnValue(hangPromise);

    // Fire first tick (will hang inside executor)
    const first = scheduler.tick();

    // Fire second tick immediately - should bail out due to busy flag
    const second = scheduler.tick();

    // Resolve the hang so first can finish
    resolveExec(makeResult());

    await Promise.all([first, second]);

    // isUserActive should only have been called once (by the first tick)
    expect(deps.activity.isUserActive).toHaveBeenCalledTimes(1);
  });

  it("P1: skips when weekly quota reached", async () => {
    deps.quota.getWeeklyUsage.mockReturnValue({
      total_tokens: 999999999,
      total_duration_ms: 0,
      task_count: 100,
    });
    await scheduler.tick();
    expect(deps.queue.pickNext).not.toHaveBeenCalled();
    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("P1: skips large task when insufficient quota", async () => {
    const largeTask = makeTask({ size: "large" });
    deps.quota.getAvailableTokens.mockReturnValue(50000); // less than 60000 needed
    deps.queue.pickNext.mockReturnValue(largeTask);
    await scheduler.tick();
    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("P1: dry-run mode logs but does not execute", async () => {
    const dryScheduler = new Scheduler(deps, { dryRun: true });
    await dryScheduler.tick();
    expect(deps.executor.execute).not.toHaveBeenCalled();
    expect(deps.queue.updateTask).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[DRY RUN]"),
      expect.objectContaining({ id: "task-1" })
    );
  });

  describe("digest scheduling", () => {
    it("sends daily digest when hour matches and not yet sent today", async () => {
      vi.useFakeTimers();
      // Set time to daily_report_hour (DEFAULT_CONFIG.daily_report_hour = 8), so hour >= 8
      vi.setSystemTime(new Date("2026-04-03T13:00:00.000Z"));
      // Adjust config to match local hour: override to use UTC hour directly
      deps.config.daily_report_hour = 8;

      try {
        await scheduler.tick();
        expect(deps.notifier.sendDailyDigest).toHaveBeenCalledTimes(1);
        expect(deps.notifier.sendDailyDigest).toHaveBeenCalledWith(
          [],
          expect.any(Number),
          expect.any(Number)
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not send duplicate daily digest on same day", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-03T13:00:00.000Z"));
      deps.config.daily_report_hour = 8;

      try {
        // First tick - should send digest
        await scheduler.tick();
        expect(deps.notifier.sendDailyDigest).toHaveBeenCalledTimes(1);

        // Second tick same day - should NOT send again
        await scheduler.tick();
        expect(deps.notifier.sendDailyDigest).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("start / stop", () => {
    it("calls recoverRunningTasks on start", () => {
      deps.queue.recoverRunningTasks.mockReturnValue(2);
      scheduler.start();
      scheduler.stop();
      expect(deps.queue.recoverRunningTasks).toHaveBeenCalled();
    });

    it("registers own pid on start", () => {
      scheduler.start();
      scheduler.stop();
      expect(deps.activity.registerOwnPid).toHaveBeenCalledWith(process.pid);
    });
  });
});
