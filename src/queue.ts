import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { Task, TaskQueue, TaskPriority, TaskSize } from "./types.js";
import { SIZE_TOKEN_ESTIMATES } from "./types.js";

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
  private projectsRoot: string;

  constructor(filePath: string, projectsRoot: string) {
    this.filePath = filePath;
    this.projectsRoot = projectsRoot;
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
    const projectPath = join(this.projectsRoot, input.project);
    if (!existsSync(projectPath)) {
      throw new Error(
        `Project path does not exist: ${projectPath}`
      );
    }

    const task: Task = {
      id: randomUUID().slice(0, 8),
      description: input.description,
      project: input.project,
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
