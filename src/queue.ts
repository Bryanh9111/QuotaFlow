import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { resolve, sep } from "path";
import type { Task, TaskQueue, TaskPriority, TaskSize } from "./types.js";
import { SIZE_TOKEN_ESTIMATES } from "./types.js";
import { resolveProject } from "./project-resolver.js";

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

interface AddTaskInput {
  description: string;
  project: string;
  priority: TaskPriority;
  size: TaskSize;
}

export class TaskQueueManager {
  private filePath: string;
  private roots: string[];

  constructor(filePath: string, rootsOrRoot: string | string[]) {
    this.filePath = filePath;
    this.roots = Array.isArray(rootsOrRoot)
      ? rootsOrRoot.filter((r) => r && r.length > 0)
      : rootsOrRoot
        ? [rootsOrRoot]
        : [];
  }

  private read(): TaskQueue {
    if (!existsSync(this.filePath)) {
      return { tasks: [] };
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as TaskQueue;
    } catch {
      return { tasks: [] };
    }
  }

  private write(queue: TaskQueue): void {
    writeFileSync(this.filePath, JSON.stringify(queue, null, 2), "utf-8");
  }

  getAll(): Task[] {
    return this.read().tasks;
  }

  getQueued(): Task[] {
    return this.read().tasks
      .filter((t) => t.status === "queued")
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  addTask(input: AddTaskInput): Task {
    const outcome = resolveProject(input.project, this.roots);
    if (!outcome.hit) {
      const hint = outcome.candidates.length > 0
        ? ` Candidates: ${outcome.candidates.map((c) => c.name).join(", ")}`
        : "";
      throw new Error(`Project not found in configured roots: ${input.project}.${hint}`);
    }

    const task: Task = {
      id: randomUUID().slice(0, 8),
      description: input.description,
      // Canonicalize to resolved project name so subsequent executors don't re-guess.
      project: outcome.hit.name,
      priority: input.priority,
      size: input.size,
      status: "queued",
      created_at: new Date().toISOString(),
    };

    const queue = this.read();
    queue.tasks.push(task);
    this.write(queue);
    return task;
  }

  updateTask(id: string, updates: Partial<Task>): Task {
    const queue = this.read();
    const idx = queue.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task not found: ${id}`);
    queue.tasks[idx] = { ...queue.tasks[idx], ...updates };
    this.write(queue);
    return queue.tasks[idx];
  }

  completeTask(
    id: string,
    meta: { branch: string; tokens_used: number; duration_ms: number }
  ): Task {
    return this.updateTask(id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      branch: meta.branch,
      tokens_used: meta.tokens_used,
      duration_ms: meta.duration_ms,
    });
  }

  failTask(id: string, error: string): Task {
    return this.updateTask(id, {
      status: "failed",
      error,
    });
  }

  pickNext(availableTokens: number): Task | null {
    const queued = this.getQueued();
    for (const task of queued) {
      if (SIZE_TOKEN_ESTIMATES[task.size] <= availableTokens) {
        return task;
      }
    }
    return null;
  }

  pickNextExcluding(availableTokens: number, excludeProjects: string[]): Task | null {
    const excludeSet = new Set(excludeProjects);
    const queued = this.getQueued();
    for (const task of queued) {
      if (excludeSet.has(task.project)) continue;
      if (SIZE_TOKEN_ESTIMATES[task.size] <= availableTokens) {
        return task;
      }
    }
    return null;
  }

  recoverRunningTasks(): number {
    const queue = this.read();
    let count = 0;
    for (const task of queue.tasks) {
      if (task.status === "running") {
        task.status = "queued";
        count++;
      }
    }
    if (count > 0) this.write(queue);
    return count;
  }
}
