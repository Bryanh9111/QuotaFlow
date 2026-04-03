import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { loadConfig, validateConfig } from "./config.js";
import { TaskQueueManager } from "./queue.js";
import { QuotaMonitor } from "./quota.js";
import { ActivityDetector } from "./activity.js";
import { TaskExecutor } from "./executor.js";
import { Notifier } from "./notify.js";
import { Logger } from "./logger.js";
import { Scheduler } from "./scheduler.js";

const QUOTAFLOW_DIR = join(homedir(), ".quotaflow");
const CONFIG_PATH = join(QUOTAFLOW_DIR, "config.json");
const TASKS_PATH = join(QUOTAFLOW_DIR, "tasks.json");
const DB_PATH = join(QUOTAFLOW_DIR, "data.db");
const LOGS_DIR = join(QUOTAFLOW_DIR, "logs");

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  mkdirSync(QUOTAFLOW_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });

  const config = loadConfig(CONFIG_PATH);
  validateConfig(config);

  const logger = new Logger(LOGS_DIR);
  const queue = new TaskQueueManager(TASKS_PATH, config.projects_root);
  const quota = new QuotaMonitor(DB_PATH, config.quota);
  const activity = new ActivityDetector(config.inactivity_threshold_minutes);
  const executor = new TaskExecutor(config.timeouts);
  const notifier = new Notifier(config.discord_webhook_url);

  const scheduler = new Scheduler({
    config,
    activity,
    quota,
    queue,
    executor,
    notifier,
    logger,
  }, { dryRun });

  const shutdown = (): void => {
    logger.info("Shutting down...");
    scheduler.stop();
    quota.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  logger.info("QuotaFlow starting", {
    projects_root: config.projects_root,
    interval: config.check_interval_minutes,
    webhook: config.discord_webhook_url ? "configured" : "not configured",
    dry_run: dryRun,
  });

  if (dryRun) {
    logger.info("DRY RUN MODE - no tasks will be executed");
  }

  scheduler.start();
}

main();
