import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TaskQueueManager } from "../src/queue.js";
import type { Task } from "../src/types.js";

// Unique temp dir per test run
const BASE_DIR = join(tmpdir(), `quotaflow-test-${process.pid}`);
const QUEUE_FILE = join(BASE_DIR, "queue.json");
const PROJECTS_DIR = join(BASE_DIR, "projects");

function makeManager(): TaskQueueManager {
  return new TaskQueueManager(QUEUE_FILE, PROJECTS_DIR);
}

beforeEach(() => {
  // Clean and recreate directories
  if (existsSync(BASE_DIR)) rmSync(BASE_DIR, { recursive: true });
  mkdirSync(BASE_DIR, { recursive: true });
  mkdirSync(PROJECTS_DIR, { recursive: true });

  // Create fake project directories
  mkdirSync(join(PROJECTS_DIR, "Relay"), { recursive: true });
  mkdirSync(join(PROJECTS_DIR, "Athena"), { recursive: true });
});

describe("TaskQueueManager", () => {
  it("returns empty list when no file exists", () => {
    const mgr = makeManager();
    expect(mgr.getAll()).toEqual([]);
    expect(mgr.getQueued()).toEqual([]);
  });

  it("adds and retrieves a task", () => {
    const mgr = makeManager();
    const task = mgr.addTask({
      description: "Build feature X",
      project: "Relay",
      priority: "medium",
      size: "small",
    });

    expect(task.id).toHaveLength(8);
    expect(task.status).toBe("queued");
    expect(task.project).toBe("Relay");

    const all = mgr.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(task.id);
  });

  it("sorts queued tasks by priority: high > medium > low", () => {
    const mgr = makeManager();
    mgr.addTask({ description: "Low task", project: "Relay", priority: "low", size: "small" });
    mgr.addTask({ description: "High task", project: "Relay", priority: "high", size: "small" });
    mgr.addTask({ description: "Medium task", project: "Relay", priority: "medium", size: "small" });

    const queued = mgr.getQueued();
    expect(queued[0].priority).toBe("high");
    expect(queued[1].priority).toBe("medium");
    expect(queued[2].priority).toBe("low");
  });

  it("updates a task status", () => {
    const mgr = makeManager();
    const task = mgr.addTask({
      description: "Update me",
      project: "Relay",
      priority: "low",
      size: "small",
    });

    const updated = mgr.updateTask(task.id, { status: "running" });
    expect(updated.status).toBe("running");
    expect(mgr.getAll()[0].status).toBe("running");
  });

  it("completes a task with metadata", () => {
    const mgr = makeManager();
    const task = mgr.addTask({
      description: "Complete me",
      project: "Athena",
      priority: "high",
      size: "medium",
    });

    const completed = mgr.completeTask(task.id, {
      branch: "feat/done",
      tokens_used: 25000,
      duration_ms: 12000,
    });

    expect(completed.status).toBe("completed");
    expect(completed.branch).toBe("feat/done");
    expect(completed.tokens_used).toBe(25000);
    expect(completed.duration_ms).toBe(12000);
    expect(completed.completed_at).toBeDefined();
  });

  it("fails a task with error message", () => {
    const mgr = makeManager();
    const task = mgr.addTask({
      description: "Fail me",
      project: "Relay",
      priority: "medium",
      size: "small",
    });

    const failed = mgr.failTask(task.id, "Claude crashed");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Claude crashed");
  });

  it("rejects addTask when project path does not exist", () => {
    const mgr = makeManager();
    expect(() =>
      mgr.addTask({
        description: "Ghost project",
        project: "NonExistent",
        priority: "high",
        size: "small",
      })
    ).toThrow(/does not exist/);
  });

  it("pickNext returns highest-priority task within token budget", () => {
    const mgr = makeManager();
    // small=10000, medium=30000, large=60000
    mgr.addTask({ description: "Big task", project: "Relay", priority: "high", size: "large" });
    mgr.addTask({ description: "Med task", project: "Relay", priority: "medium", size: "medium" });
    mgr.addTask({ description: "Sm task", project: "Relay", priority: "low", size: "small" });

    // Only 35000 tokens available: large (60000) won't fit, medium (30000) fits
    const next = mgr.pickNext(35000);
    expect(next).not.toBeNull();
    expect(next!.size).toBe("medium");
    expect(next!.priority).toBe("medium");
  });

  it("pickNext returns null when no task fits within token budget", () => {
    const mgr = makeManager();
    mgr.addTask({ description: "Large task", project: "Relay", priority: "high", size: "large" });

    const next = mgr.pickNext(5000); // less than small (10000)
    expect(next).toBeNull();
  });

  it("pickNext returns null on empty queue", () => {
    const mgr = makeManager();
    expect(mgr.pickNext(100000)).toBeNull();
  });

  it("persists tasks across separate manager instances", () => {
    const mgr1 = makeManager();
    const task = mgr1.addTask({
      description: "Persistent task",
      project: "Athena",
      priority: "high",
      size: "small",
    });

    const mgr2 = makeManager();
    const all = mgr2.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(task.id);
    expect(all[0].description).toBe("Persistent task");
  });

  it("recoverRunningTasks resets stuck running tasks to queued", () => {
    const mgr = makeManager();
    const t1 = mgr.addTask({ description: "Task 1", project: "Relay", priority: "high", size: "small" });
    const t2 = mgr.addTask({ description: "Task 2", project: "Relay", priority: "medium", size: "small" });
    const t3 = mgr.addTask({ description: "Task 3", project: "Relay", priority: "low", size: "small" });

    // Simulate two tasks stuck in running state
    mgr.updateTask(t1.id, { status: "running" });
    mgr.updateTask(t2.id, { status: "running" });

    // New manager instance (simulating restart)
    const mgr2 = makeManager();
    const recovered = mgr2.recoverRunningTasks();
    expect(recovered).toBe(2);

    const all = mgr2.getAll();
    const statuses = Object.fromEntries(all.map((t) => [t.id, t.status]));
    expect(statuses[t1.id]).toBe("queued");
    expect(statuses[t2.id]).toBe("queued");
    expect(statuses[t3.id]).toBe("queued"); // was already queued
  });

  it("recoverRunningTasks returns 0 when no stuck tasks", () => {
    const mgr = makeManager();
    mgr.addTask({ description: "Clean task", project: "Relay", priority: "high", size: "small" });
    expect(mgr.recoverRunningTasks()).toBe(0);
  });

  it("pickNext skips non-queued tasks", () => {
    const mgr = makeManager();
    const t = mgr.addTask({ description: "Running task", project: "Relay", priority: "high", size: "small" });
    mgr.updateTask(t.id, { status: "running" });

    expect(mgr.pickNext(100000)).toBeNull();
  });
});
