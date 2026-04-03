import type { TaskQueueManager } from "./queue.js";
import type { QuotaMonitor } from "./quota.js";
import type { TaskPriority, TaskSize } from "./types.js";
import { applyTemplate, listTemplates } from "./templates.js";

// ANSI color helpers
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const WHITE = "\x1b[37m";
const RESET = "\x1b[0m";

export interface ParsedArgs {
  command: string | null;
  args: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  // argv is process.argv.slice(2) or equivalent caller-trimmed array
  const SUBCOMMANDS = new Set(["add", "list", "rm", "status", "template", "templates"]);

  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(token);
      i += 1;
    }
  }

  const first = positional[0] ?? null;
  const command = first !== null && SUBCOMMANDS.has(first) ? first : null;
  const args = command !== null ? positional.slice(1) : positional;

  return { command, args, flags };
}

export function runAdd(
  queue: TaskQueueManager,
  args: string[],
  flags: Record<string, string | boolean>
): string {
  const description = args[0];
  if (!description) {
    throw new Error("Missing required argument: description");
  }

  const project = flags["project"];
  if (!project || typeof project !== "string") {
    throw new Error("Missing required flag: --project");
  }

  const priority = (flags["priority"] as TaskPriority | undefined) ?? "medium";
  const size = (flags["size"] as TaskSize | undefined) ?? "medium";

  const task = queue.addTask({ description, project, priority, size });
  return `Task added: [${task.priority}] ${task.id} | ${task.project} | ${task.description}`;
}

export function runList(queue: TaskQueueManager): string {
  const tasks = queue.getAll();

  if (tasks.length === 0) {
    return "No tasks found.";
  }

  const groups: Record<string, typeof tasks> = {
    queued: [],
    running: [],
    completed: [],
    failed: [],
    skipped: [],
  };

  for (const task of tasks) {
    const bucket = groups[task.status] ?? (groups[task.status] = []);
    bucket.push(task);
  }

  const colorMap: Record<string, string> = {
    queued: WHITE,
    running: YELLOW,
    completed: GREEN,
    failed: RED,
    skipped: WHITE,
  };

  const lines: string[] = [];
  const order = ["queued", "running", "completed", "failed", "skipped"];

  for (const status of order) {
    const bucket = groups[status];
    if (!bucket || bucket.length === 0) continue;
    lines.push(`\n${status.toUpperCase()}`);
    for (const task of bucket) {
      const color = colorMap[status] ?? WHITE;
      lines.push(
        `${color}[${task.priority}] ${task.id} | ${task.project} | ${task.description}${RESET}`
      );
    }
  }

  return lines.join("\n").trim();
}

export function runRemove(queue: TaskQueueManager, id: string): string {
  if (!id) {
    throw new Error("Missing required argument: id");
  }
  queue.updateTask(id, { status: "skipped" });
  return `Task ${id} removed (marked as skipped).`;
}

export function runStatus(
  queue: TaskQueueManager,
  quota: QuotaMonitor
): string {
  const available = quota.getAvailableTokens();
  // The usable ceiling mirrors quota.ts: floor(tokens_per_window * (1 - buffer/100))
  // We surface raw window capacity from getWeeklyUsage context; derive max from available+used
  const windowStart = Date.now(); // approximate - display only
  const weekly = quota.getWeeklyUsage();
  const queued = queue.getQueued().length;

  // Re-derive total capacity by asking for available when nothing is used.
  // We can't access private config, so display available/total as available + weekly window used.
  // Use a simple heuristic: show available / (available + weekly_tokens) if within window.
  const windowTokensUsed = weekly.total_tokens;
  const displayTotal = available + windowTokensUsed;

  const availableFormatted = available.toLocaleString();
  const totalFormatted = displayTotal.toLocaleString();
  const weeklyFormatted = weekly.total_tokens.toLocaleString();

  return [
    "QuotaFlow Status",
    `  Available tokens: ${availableFormatted} / ${totalFormatted}`,
    `  Weekly usage: ${weeklyFormatted} tokens (${weekly.task_count} tasks)`,
    `  Queued tasks: ${queued}`,
  ].join("\n");
}

export function runTemplate(
  queue: TaskQueueManager,
  args: string[],
  flags: Record<string, string | boolean>
): string {
  const templateName = args[0];
  if (!templateName) {
    throw new Error("Missing required argument: template name");
  }

  const project = flags["project"];
  if (!project || typeof project !== "string") {
    throw new Error("Missing required flag: --project");
  }

  const result = applyTemplate(templateName, project);
  if (!result) {
    throw new Error(`Unknown template: ${templateName}`);
  }

  const task = queue.addTask({
    description: result.description,
    project,
    priority: result.priority,
    size: result.size,
  });
  return `Task added from template '${templateName}': [${task.priority}] ${task.id} | ${task.project} | ${task.description}`;
}

export function runCli(
  argv: string[],
  queue: TaskQueueManager,
  quota: QuotaMonitor
): string | null {
  const { command, args, flags } = parseArgs(argv);

  if (command === null) {
    return null; // caller should start daemon
  }

  switch (command) {
    case "add":
      return runAdd(queue, args, flags);
    case "list":
      return runList(queue);
    case "rm": {
      const id = args[0];
      return runRemove(queue, id);
    }
    case "status":
      return runStatus(queue, quota);
    case "template":
      return runTemplate(queue, args, flags);
    case "templates":
      return `Available templates:\n${listTemplates()}`;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
