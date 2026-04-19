import { join } from "node:path";
import type { Config, Task, ExecutionResult, RateLimitInfo } from "./types.js";
import { getProjectsRoots } from "./config.js";
import { resolveProject } from "./project-resolver.js";

interface SchedulerDeps {
  config: Config;
  activity: {
    isUserActive(): Promise<boolean>;
    registerOwnPid(pid: number): void;
  };
  quota: {
    getAvailableTokens(): number;
    recordUsage(taskId: string, tokens: number, durationMs: number, size?: import("./types.js").TaskSize, project?: string): void;
    getUsageByProject(sinceMs?: number): Array<{ project: string; tokens: number; count: number }>;
    getOutliers(sinceMs?: number, multiplier?: number): Array<{ task_id: string; size: string; actual: number; estimated: number }>;
    markRateLimited(): void;
    setWindowResetTime(unixTimestamp: number): void;
    isWindowExhausted(): boolean;
    getWeeklyUsage(): { total_tokens: number; total_duration_ms: number; task_count: number };
  };
  queue: {
    pickNext(availableTokens: number): Task | null;
    pickNextExcluding(availableTokens: number, excludeProjects: string[]): Task | null;
    updateTask(id: string, updates: Partial<Task>): void;
    completeTask(id: string, meta: { branch: string; tokens_used: number; duration_ms: number }): void;
    failTask(id: string, error: string): void;
    recoverRunningTasks(): number;
    getAll(): Task[];
  };
  executor: {
    execute(task: Task, projectPath: string): Promise<ExecutionResult>;
    probeQuota?(): Promise<{ session: RateLimitInfo | null; weekly: RateLimitInfo | null }>;
  };
  notifier: {
    taskCompleted(task: Task, result: ExecutionResult): Promise<void>;
    sendMessage(content: string): Promise<void>;
    sendDailyDigest(
      tasks: Task[],
      quotaUsed: number,
      quotaTotal: number,
      projectBreakdown?: Array<{ project: string; tokens: number; count: number }>,
      outliers?: Array<{ task_id: string; size: string; actual: number; estimated: number }>
    ): Promise<void>;
  };
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    debug(msg: string, data?: Record<string, unknown>): void;
  };
}

export class Scheduler {
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dryRun: boolean;
  private lastDailyDigest: string | null = null;
  private lastWeeklyDigest: string | null = null;
  private activeProjects: Set<string> = new Set();
  private weeklyAllowedSize: "small" | "medium" | "large" = "large";

  constructor(private deps: SchedulerDeps, options?: { dryRun?: boolean }) {
    this.dryRun = options?.dryRun ?? false;
  }

  async tick(): Promise<void> {
    if (this.busy) {
      this.deps.logger.debug("tick skipped: previous still running");
      return;
    }
    this.busy = true;
    try {
      await this.doTick();
    } finally {
      try {
        await this.checkDigests();
      } catch (err) {
        this.deps.logger.error("checkDigests failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.busy = false;
    }
  }

  /** Lightweight probe: check session + weekly rate limit status before dispatch */
  private async probeQuota(): Promise<"ok" | "overage" | "weekly_limit" | "error"> {
    const { executor, quota, logger } = this.deps;
    if (!executor.probeQuota) return "ok";

    try {
      const { session, weekly } = await executor.probeQuota();

      // Check session (five_hour) limit
      if (session) {
        if (session.isUsingOverage || (session.status !== "allowed" && session.status !== "allowed_warning")) {
          quota.markRateLimited();
          quota.setWindowResetTime(session.resetsAt);
          return "overage";
        }
      }

      // Check weekly (seven_day) limit
      if (weekly) {
        const weeklyPct = (weekly.utilization ?? 0) * 100;
        logger.debug("weekly quota status", { utilization: `${weeklyPct.toFixed(0)}%`, status: weekly.status });

        if (weekly.isUsingOverage || (weekly.status !== "allowed" && weekly.status !== "allowed_warning")) {
          logger.warn("weekly quota exhausted - stopping dispatch", { utilization: `${weeklyPct.toFixed(0)}%` });
          return "weekly_limit";
        }

        // Stop if weekly > 90% to preserve quota for manual use
        if (weeklyPct >= 90) {
          logger.warn("weekly quota > 90% - stopping dispatch to preserve manual quota", { utilization: `${weeklyPct.toFixed(0)}%` });
          return "weekly_limit";
        }

        // Only allow small tasks if weekly > 75%
        if (weeklyPct >= 75) {
          this.weeklyAllowedSize = "small";
        } else if (weeklyPct >= 60) {
          this.weeklyAllowedSize = "medium";
        } else {
          this.weeklyAllowedSize = "large";
        }
      }

      return "ok";
    } catch {
      logger.warn("quota probe failed, proceeding cautiously");
      return "error";
    }
  }

  private async doTick(): Promise<void> {
    const { config, activity, quota, queue, executor, notifier, logger } = this.deps;

    const active = await activity.isUserActive();
    if (active) {
      logger.debug("tick skipped: user active");
      return;
    }

    if (quota.isWindowExhausted()) {
      logger.debug("tick skipped: window exhausted");
      return;
    }

    const available = quota.getAvailableTokens();
    if (available <= 0) {
      logger.debug("tick skipped: no available tokens", { available });
      return;
    }

    // Pre-dispatch quota probe: check session + weekly rate limit (real data from Claude CLI)
    this.weeklyAllowedSize = "large"; // reset before probe
    const probeResult = await this.probeQuota();
    if (probeResult === "overage") {
      logger.warn("probe detected session overage - skipping dispatch until reset");
      return;
    }
    if (probeResult === "weekly_limit") {
      logger.warn("weekly quota limit reached - skipping dispatch until weekly reset");
      return;
    }

    // Estimate usage percentage from self-tracked data for task size gating
    const windowCapacity = config.quota.tokens_per_5h_window;
    const selfTrackedUsed = windowCapacity - available;
    const usagePct = windowCapacity > 0 ? (selfTrackedUsed / windowCapacity) * 100 : 0;
    let allowedSize: "small" | "medium" | "large" = "large";
    if (usagePct >= 90) {
      logger.debug("tick skipped: usage >= 90%, waiting for reset", { usagePct: Math.round(usagePct) });
      return;
    } else if (usagePct >= 75) {
      allowedSize = "small";
    } else if (usagePct >= 60) {
      allowedSize = "medium";
    }

    const maxConcurrency = config.max_concurrency ?? 1;

    // Collect tasks to dispatch this tick
    type Dispatch = { task: Task; promise: Promise<ExecutionResult | { __threw: true; msg: string }> };
    const dispatches: Dispatch[] = [];
    const tickProjects = new Set<string>(this.activeProjects);

    for (let slot = 0; slot < maxConcurrency; slot++) {
      const slotAvailable = quota.getAvailableTokens();
      if (slotAvailable <= 0) break;

      const task = queue.pickNextExcluding(slotAvailable, Array.from(tickProjects));
      if (!task) break;

      // Size gating: use the more restrictive of session and weekly limits
      const sizeRank = { small: 0, medium: 1, large: 2 } as const;
      const effectiveAllowed = sizeRank[this.weeklyAllowedSize] < sizeRank[allowedSize]
        ? this.weeklyAllowedSize : allowedSize;
      if (sizeRank[task.size] > sizeRank[effectiveAllowed]) {
        logger.debug("slot skipped: task size exceeds allowed level", {
          taskSize: task.size,
          sessionAllowed: allowedSize,
          weeklyAllowed: this.weeklyAllowedSize,
          effective: effectiveAllowed,
        });
        break;
      }

      // P1: dry-run mode
      if (this.dryRun) {
        logger.info("[DRY RUN] would execute task", {
          id: task.id,
          project: task.project,
          description: task.description,
          size: task.size,
          available_tokens: slotAvailable,
        });
        tickProjects.add(task.project);
        continue;
      }

      tickProjects.add(task.project);
      this.activeProjects.add(task.project);
      queue.updateTask(task.id, { status: "running" });
      logger.info("executing task", { id: task.id, project: task.project });

      const roots = getProjectsRoots(config);
      let projectPath: string;
      if (roots.length === 0) {
        // Legacy single-root mode: config.projects_root may be empty in unit tests.
        projectPath = join(config.projects_root, task.project);
      } else {
        const resolved = resolveProject(task.project, roots);
        if (!resolved.hit) {
          const msg = `project not found in configured roots: ${task.project}`;
          logger.error(msg, { project: task.project, roots });
          queue.failTask(task.id, msg);
          this.activeProjects.delete(task.project);
          tickProjects.delete(task.project);
          await notifier.taskCompleted(task, {
            task_id: task.id, success: false, branch: "", tokens_used: 0,
            duration_ms: 0, stdout: "", stderr: "", error: msg,
          });
          continue;
        }
        projectPath = resolved.hit.path;
      }
      const promise = executor.execute(task, projectPath).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return { __threw: true as const, msg };
      });

      dispatches.push({ task, promise });
    }

    if (dispatches.length === 0) {
      if (!this.dryRun) logger.debug("tick skipped: no tasks");
      return;
    }

    // Await all concurrently
    const settled = await Promise.allSettled(dispatches.map((d) => d.promise));

    for (let i = 0; i < dispatches.length; i++) {
      const { task } = dispatches[i];
      this.activeProjects.delete(task.project);

      const outcome = settled[i];
      // Promise.allSettled won't reject since we wrapped with .catch, but handle both
      if (outcome.status === "rejected") {
        const msg = String(outcome.reason);
        logger.error("executor threw", { id: task.id, error: msg });
        queue.failTask(task.id, msg);
        if (msg.toLowerCase().includes("rate limit")) quota.markRateLimited();
        await notifier.taskCompleted(task, {
          task_id: task.id, success: false, branch: "", tokens_used: 0,
          duration_ms: 0, stdout: "", stderr: "", error: msg,
        });
        continue;
      }

      const value = outcome.value;

      // Executor threw
      if (typeof value === "object" && value !== null && "__threw" in value) {
        const { msg } = value as { __threw: true; msg: string };
        logger.error("executor threw", { id: task.id, error: msg });
        queue.failTask(task.id, msg);
        if (msg.toLowerCase().includes("rate limit")) quota.markRateLimited();
        await notifier.taskCompleted(task, {
          task_id: task.id, success: false, branch: "", tokens_used: 0,
          duration_ms: 0, stdout: "", stderr: "", error: msg,
        });
        continue;
      }

      const result = value as ExecutionResult;

      // Use real rate limit data from stream-json if available
      if (result.rate_limit) {
        const rl = result.rate_limit;
        logger.info("rate limit status from claude", {
          type: rl.rateLimitType,
          status: rl.status,
          resetsAt: new Date(rl.resetsAt * 1000).toISOString(),
          isUsingOverage: rl.isUsingOverage,
        });
        if ((rl.status !== "allowed" && rl.status !== "allowed_warning") || rl.isUsingOverage) {
          quota.markRateLimited();
          quota.setWindowResetTime(rl.resetsAt);
          if (rl.isUsingOverage) {
            logger.warn("entered overage quota - stopping dispatch until window resets");
          }
        }
      }

      if (result.success) {
        queue.completeTask(task.id, {
          branch: result.branch,
          tokens_used: result.tokens_used,
          duration_ms: result.duration_ms,
        });
        quota.recordUsage(task.id, result.tokens_used, result.duration_ms, task.size, task.project);
        logger.info("task completed", { id: task.id, tokens: result.tokens_used });
      } else {
        const errMsg = result.error ?? result.stderr ?? "unknown error";
        queue.failTask(task.id, errMsg);
        if (errMsg.toLowerCase().includes("rate limit")) quota.markRateLimited();
        logger.warn("task failed", { id: task.id, error: errMsg });
      }

      await notifier.taskCompleted(task, result);
    }
  }

  private async checkDigests(): Promise<void> {
    const { config, quota, queue, notifier } = this.deps;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    if (currentHour >= config.daily_report_hour && this.lastDailyDigest !== todayStr) {
      const weeklyUsage = quota.getWeeklyUsage();
      const quotaTotal = config.quota.tokens_per_5h_window * (24 / 5) * 7;
      const projectBreakdown = quota.getUsageByProject();
      const outliers = quota.getOutliers();
      await notifier.sendDailyDigest(queue.getAll(), weeklyUsage.total_tokens, quotaTotal, projectBreakdown, outliers);
      this.lastDailyDigest = todayStr;
    }

    if (
      currentDay === config.weekly_report_day &&
      currentHour >= config.daily_report_hour &&
      this.lastWeeklyDigest !== todayStr
    ) {
      const weeklyUsage = quota.getWeeklyUsage();
      const quotaTotal = config.quota.tokens_per_5h_window * (24 / 5) * 7;
      const projectBreakdown = quota.getUsageByProject();
      const outliers = quota.getOutliers();
      await notifier.sendDailyDigest(queue.getAll(), weeklyUsage.total_tokens, quotaTotal, projectBreakdown, outliers);
      this.lastWeeklyDigest = todayStr;
    }
  }

  start(): void {
    const { config, queue, logger } = this.deps;

    const recovered = queue.recoverRunningTasks();
    if (recovered > 0) {
      logger.info("recovered running tasks on startup", { count: recovered });
    }

    this.deps.activity.registerOwnPid(process.pid);

    const intervalMs = config.check_interval_minutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    void this.tick();
    logger.info("scheduler started", { interval_minutes: config.check_interval_minutes });
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.deps.logger.info("scheduler stopped");
  }
}
