import { join } from "node:path";
import type { Config, Task, ExecutionResult } from "./types.js";

interface SchedulerDeps {
  config: Config;
  activity: {
    isUserActive(): Promise<boolean>;
    registerOwnPid(pid: number): void;
  };
  quota: {
    getAvailableTokens(): number;
    recordUsage(taskId: string, tokens: number, durationMs: number): void;
    markRateLimited(): void;
    isWindowExhausted(): boolean;
    getWeeklyUsage(): { total_tokens: number; total_duration_ms: number; task_count: number };
  };
  queue: {
    pickNext(availableTokens: number): Task | null;
    updateTask(id: string, updates: Partial<Task>): void;
    completeTask(id: string, meta: { branch: string; tokens_used: number; duration_ms: number }): void;
    failTask(id: string, error: string): void;
    recoverRunningTasks(): number;
    getAll(): Task[];
  };
  executor: {
    execute(task: Task, projectPath: string): Promise<ExecutionResult>;
  };
  notifier: {
    taskCompleted(task: Task, result: ExecutionResult): Promise<void>;
    sendMessage(content: string): Promise<void>;
    sendDailyDigest(tasks: Task[], quotaUsed: number, quotaTotal: number): Promise<void>;
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
      await this.checkDigests();
      this.busy = false;
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

    // P1: check weekly quota
    const weekly = quota.getWeeklyUsage();
    const weeklyLimitTokens = config.quota.weekly_compute_hours * 3600 * 10; // rough estimate: 10 tokens/sec compute
    if (weekly.total_tokens >= weeklyLimitTokens) {
      logger.debug("tick skipped: weekly quota reached", { used: weekly.total_tokens, limit: weeklyLimitTokens });
      return;
    }

    const task = queue.pickNext(available);
    if (!task) {
      logger.debug("tick skipped: no tasks");
      return;
    }

    // P1: probe before large tasks - try a small quota check first
    if (task.size === "large" && available < 60000) {
      logger.debug("tick skipped: insufficient quota for large task, waiting", { available, needed: 60000 });
      return;
    }

    // P1: dry-run mode - log what would happen without executing
    if (this.dryRun) {
      logger.info("[DRY RUN] would execute task", {
        id: task.id,
        project: task.project,
        description: task.description,
        size: task.size,
        available_tokens: available,
      });
      return;
    }

    queue.updateTask(task.id, { status: "running" });
    logger.info("executing task", { id: task.id, project: task.project });

    const projectPath = join(config.projects_root, task.project);
    let result: ExecutionResult;

    try {
      result = await executor.execute(task, projectPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("executor threw", { id: task.id, error: msg });
      queue.failTask(task.id, msg);
      if (msg.toLowerCase().includes("rate limit")) {
        quota.markRateLimited();
      }
      await notifier.taskCompleted(task, {
        task_id: task.id,
        success: false,
        branch: "",
        tokens_used: 0,
        duration_ms: 0,
        stdout: "",
        stderr: "",
        error: msg,
      });
      return;
    }

    if (result.success) {
      queue.completeTask(task.id, {
        branch: result.branch,
        tokens_used: result.tokens_used,
        duration_ms: result.duration_ms,
      });
      quota.recordUsage(task.id, result.tokens_used, result.duration_ms);
      logger.info("task completed", { id: task.id, tokens: result.tokens_used });
    } else {
      const errMsg = result.error ?? result.stderr ?? "unknown error";
      queue.failTask(task.id, errMsg);
      if (errMsg.toLowerCase().includes("rate limit")) {
        quota.markRateLimited();
      }
      logger.warn("task failed", { id: task.id, error: errMsg });
    }

    await notifier.taskCompleted(task, result);
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
      await notifier.sendDailyDigest(queue.getAll(), weeklyUsage.total_tokens, quotaTotal);
      this.lastDailyDigest = todayStr;
    }

    if (
      currentDay === config.weekly_report_day &&
      currentHour >= config.daily_report_hour &&
      this.lastWeeklyDigest !== todayStr
    ) {
      const weeklyUsage = quota.getWeeklyUsage();
      const quotaTotal = config.quota.tokens_per_5h_window * (24 / 5) * 7;
      await notifier.sendDailyDigest(queue.getAll(), weeklyUsage.total_tokens, quotaTotal);
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
