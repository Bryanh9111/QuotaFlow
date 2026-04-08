import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TaskQueueManager } from "../src/queue.js";
import {
  parseArgs,
  runAdd,
  runList,
  runRemove,
  runStatus,
  runCli,
} from "../src/cli.js";
import type { QuotaMonitor } from "../src/quota.js";

// ---- Temp dir setup ----
const BASE_DIR = join(tmpdir(), `quotaflow-cli-test-${process.pid}`);
const QUEUE_FILE = join(BASE_DIR, "queue.json");
const PROJECTS_DIR = join(BASE_DIR, "projects");

function makeQueue(): TaskQueueManager {
  return new TaskQueueManager(QUEUE_FILE, PROJECTS_DIR);
}

function makeQuotaMock(overrides?: Partial<QuotaMonitor>): QuotaMonitor {
  return {
    getAvailableTokens: vi.fn().mockReturnValue(79200),
    getWindowCapacity: vi.fn().mockReturnValue(79200),
    getWeeklyUsage: vi.fn().mockReturnValue({
      total_tokens: 45000,
      total_duration_ms: 600000,
      task_count: 23,
    }),
    hasQuotaFor: vi.fn().mockReturnValue(true),
    recordUsage: vi.fn(),
    markRateLimited: vi.fn(),
    isWindowExhausted: vi.fn().mockReturnValue(false),
    setWindowStart: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as QuotaMonitor;
}

beforeEach(() => {
  if (existsSync(BASE_DIR)) rmSync(BASE_DIR, { recursive: true });
  mkdirSync(BASE_DIR, { recursive: true });
  mkdirSync(PROJECTS_DIR, { recursive: true });
  mkdirSync(join(PROJECTS_DIR, "ProjectAlpha"), { recursive: true });
  mkdirSync(join(PROJECTS_DIR, "ProjectBeta"), { recursive: true });
});

// ---- parseArgs ----
describe("parseArgs", () => {
  it("parses 'add' command with flags", () => {
    const result = parseArgs([
      "add",
      "Add validation to webhook",
      "--project",
      "ProjectAlpha",
      "--priority",
      "high",
      "--size",
      "medium",
    ]);
    expect(result.command).toBe("add");
    expect(result.args[0]).toBe("Add validation to webhook");
    expect(result.flags["project"]).toBe("ProjectAlpha");
    expect(result.flags["priority"]).toBe("high");
    expect(result.flags["size"]).toBe("medium");
  });

  it("parses 'list' with no flags", () => {
    const result = parseArgs(["list"]);
    expect(result.command).toBe("list");
    expect(result.args).toHaveLength(0);
    expect(result.flags).toEqual({});
  });

  it("parses 'rm' with ID argument", () => {
    const result = parseArgs(["rm", "abc123"]);
    expect(result.command).toBe("rm");
    expect(result.args[0]).toBe("abc123");
  });

  it("returns null command for no subcommand", () => {
    const result = parseArgs([]);
    expect(result.command).toBeNull();
  });

  it("returns null command for unknown token", () => {
    const result = parseArgs(["--dry-run"]);
    expect(result.command).toBeNull();
    expect(result.flags["dry-run"]).toBe(true);
  });
});

// ---- runAdd ----
describe("runAdd", () => {
  it("creates task and returns success message", () => {
    const queue = makeQueue();
    const msg = runAdd(queue, ["Add validation to webhook"], {
      project: "ProjectAlpha",
      priority: "high",
      size: "medium",
    });
    expect(msg).toMatch(/Task added/);
    expect(msg).toMatch(/high/);
    expect(msg).toMatch(/ProjectAlpha/);
    expect(msg).toMatch(/Add validation to webhook/);

    const tasks = queue.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("queued");
  });

  it("defaults priority and size to medium", () => {
    const queue = makeQueue();
    const msg = runAdd(queue, ["Simple task"], { project: "ProjectAlpha" });
    expect(msg).toMatch(/medium/);
    const tasks = queue.getAll();
    expect(tasks[0].priority).toBe("medium");
    expect(tasks[0].size).toBe("medium");
  });

  it("rejects missing description", () => {
    const queue = makeQueue();
    expect(() => runAdd(queue, [], { project: "ProjectAlpha" })).toThrow(
      /description/
    );
  });

  it("rejects missing --project", () => {
    const queue = makeQueue();
    expect(() =>
      runAdd(queue, ["Some task"], {})
    ).toThrow(/project/);
  });
});

// ---- runList ----
describe("runList", () => {
  it("returns 'No tasks found.' when queue is empty", () => {
    const queue = makeQueue();
    expect(runList(queue)).toBe("No tasks found.");
  });

  it("returns formatted task list grouped by status", () => {
    const queue = makeQueue();
    queue.addTask({
      description: "Add validation to webhook",
      project: "ProjectAlpha",
      priority: "high",
      size: "medium",
    });

    const output = runList(queue);
    expect(output).toMatch(/QUEUED/);
    expect(output).toMatch(/high/);
    expect(output).toMatch(/ProjectAlpha/);
    expect(output).toMatch(/Add validation to webhook/);
  });

  it("groups tasks by status with correct headings", () => {
    const queue = makeQueue();
    const t1 = queue.addTask({
      description: "Task one",
      project: "ProjectAlpha",
      priority: "high",
      size: "small",
    });
    queue.addTask({
      description: "Task two",
      project: "ProjectBeta",
      priority: "low",
      size: "small",
    });
    queue.updateTask(t1.id, { status: "completed" });

    const output = runList(queue);
    expect(output).toMatch(/QUEUED/);
    expect(output).toMatch(/COMPLETED/);
    expect(output).not.toMatch(/RUNNING/);
  });
});

// ---- runRemove ----
describe("runRemove", () => {
  it("marks task as skipped and returns confirmation", () => {
    const queue = makeQueue();
    const task = queue.addTask({
      description: "To be removed",
      project: "ProjectAlpha",
      priority: "medium",
      size: "small",
    });

    const msg = runRemove(queue, task.id);
    expect(msg).toMatch(task.id);
    expect(msg).toMatch(/skipped/i);

    const updated = queue.getAll().find((t) => t.id === task.id);
    expect(updated?.status).toBe("skipped");
  });

  it("throws on missing ID", () => {
    const queue = makeQueue();
    expect(() => runRemove(queue, "")).toThrow();
  });
});

// ---- runStatus ----
describe("runStatus", () => {
  it("returns formatted status output", () => {
    const queue = makeQueue();
    const quota = makeQuotaMock();

    const output = runStatus(queue, quota);
    expect(output).toMatch(/QuotaFlow Status/);
    expect(output).toMatch(/Window tokens/);
    expect(output).toMatch(/79,200/);
    expect(output).toMatch(/Weekly usage/);
    expect(output).toMatch(/45,000/);
    expect(output).toMatch(/23 tasks/);
    expect(output).toMatch(/Queued tasks: 0/);
  });

  it("reflects queued task count", () => {
    const queue = makeQueue();
    queue.addTask({
      description: "Pending work",
      project: "ProjectAlpha",
      priority: "high",
      size: "small",
    });
    const quota = makeQuotaMock();

    const output = runStatus(queue, quota);
    expect(output).toMatch(/Queued tasks: 1/);
  });
});

// ---- runCli integration ----
describe("runCli", () => {
  it("returns null for empty argv (daemon mode)", () => {
    const queue = makeQueue();
    const quota = makeQuotaMock();
    expect(runCli([], queue, quota)).toBeNull();
  });

  it("routes 'status' command", () => {
    const queue = makeQueue();
    const quota = makeQuotaMock();
    const output = runCli(["status"], queue, quota);
    expect(output).toMatch(/QuotaFlow Status/);
  });

  it("routes 'list' command", () => {
    const queue = makeQueue();
    const quota = makeQuotaMock();
    const output = runCli(["list"], queue, quota);
    expect(output).toBe("No tasks found.");
  });

  it("routes 'add' command end-to-end", () => {
    const queue = makeQueue();
    const quota = makeQuotaMock();
    const output = runCli(
      ["add", "My task", "--project", "ProjectAlpha", "--priority", "low", "--size", "small"],
      queue,
      quota
    );
    expect(output).toMatch(/Task added/);
    expect(queue.getAll()).toHaveLength(1);
  });

  it("routes 'rm' command end-to-end", () => {
    const queue = makeQueue();
    const quota = makeQuotaMock();
    const task = queue.addTask({
      description: "Removable",
      project: "ProjectAlpha",
      priority: "medium",
      size: "small",
    });
    const output = runCli(["rm", task.id], queue, quota);
    expect(output).toMatch(task.id);
    expect(queue.getAll()[0].status).toBe("skipped");
  });
});
