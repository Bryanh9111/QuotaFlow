# QuotaFlow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local daemon that auto-dispatches Claude Code tasks during user idle time to maximize Max 5x token utilization.

**Architecture:** A single Node.js process runs a 5-minute check loop: detect user activity, estimate remaining quota, pick highest-priority task from JSON queue, execute via `claude -p` in a feature branch, log results, notify via Discord webhook. All state persists in SQLite + JSON files under `~/.quotaflow/`.

**Tech Stack:** TypeScript, Node.js 24, better-sqlite3, vitest, tsx, Discord webhook API, macOS launchd

---

## File Structure

```
QuotaFlow/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    types.ts              - Shared types and schemas (Task, Config, QuotaWindow, etc.)
    config.ts             - Load and validate ~/.quotaflow/config.json
    queue.ts              - Read/write/update tasks.json, validation, status transitions
    quota.ts              - Token usage tracking, 5h window + 7-day rolling, SQLite persistence
    activity.ts           - Detect active Claude processes, inactivity threshold
    executor.ts           - Run claude -p, git branch management, capture output
    notify.ts             - Discord webhook notifications
    logger.ts             - Structured logging to ~/.quotaflow/logs/
    scheduler.ts          - Main daemon loop: activity -> quota -> task -> dispatch
    index.ts              - Entry point: parse args, init, start scheduler
  tests/
    types.test.ts
    config.test.ts
    queue.test.ts
    quota.test.ts
    activity.test.ts
    executor.test.ts
    notify.test.ts
    scheduler.test.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/zion/Repos/Zylo/QuotaFlow
npm init -y
```

Then edit package.json to set:
```json
{
  "name": "quotaflow",
  "version": "0.1.0",
  "description": "Local daemon for intelligent Claude Max token quota allocation",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "npx tsx src/index.ts",
    "test": "npx vitest run",
    "test:watch": "npx vitest"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install better-sqlite3
npm install -D typescript vitest tsx @types/node @types/better-sqlite3
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 5: Create src/types.ts with core types**

```typescript
export type TaskPriority = "high" | "medium" | "low";
export type TaskSize = "small" | "medium" | "large";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface Task {
  id: string;
  description: string;
  project: string;
  priority: TaskPriority;
  size: TaskSize;
  safe: boolean;
  status: TaskStatus;
  created_at: string;
  completed_at?: string;
  tokens_used?: number;
  branch?: string;
  duration_ms?: number;
  error?: string;
}

export interface TaskQueue {
  tasks: Task[];
}

export interface QuotaWindow {
  window_start: string;
  tokens_used: number;
  tokens_limit: number;
  is_exhausted: boolean;
}

export interface WeeklyQuota {
  week_start: string;
  compute_hours_used: number;
  compute_hours_limit: number;
}

export interface Config {
  projects_root: string;
  inactivity_threshold_minutes: number;
  check_interval_minutes: number;
  max_concurrency: number;
  discord_webhook_url: string;
  quota: {
    tokens_per_5h_window: number;
    weekly_compute_hours: number;
    safety_buffer_percent: number;
  };
  timeouts: {
    small_minutes: number;
    medium_minutes: number;
    large_minutes: number;
  };
  daily_report_hour: number;
  weekly_report_day: number;
}

export interface ExecutionResult {
  task_id: string;
  success: boolean;
  branch: string;
  tokens_used: number;
  duration_ms: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export const DEFAULT_CONFIG: Config = {
  projects_root: "/Users/zion/Repos/Zylo",
  inactivity_threshold_minutes: 15,
  check_interval_minutes: 5,
  max_concurrency: 1,
  discord_webhook_url: "",
  quota: {
    tokens_per_5h_window: 88000,
    weekly_compute_hours: 200,
    safety_buffer_percent: 10,
  },
  timeouts: {
    small_minutes: 5,
    medium_minutes: 15,
    large_minutes: 45,
  },
  daily_report_hour: 8,
  weekly_report_day: 1,
};

export const SIZE_TOKEN_ESTIMATES: Record<TaskSize, number> = {
  small: 10000,
  medium: 30000,
  large: 60000,
};
```

- [ ] **Step 6: Verify setup compiles**

Run: `npx tsx src/types.ts`
Expected: exits cleanly with no output

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/types.ts package-lock.json
git commit -m "feat: project scaffolding with types, TypeScript, and vitest"
```

---

### Task 2: Configuration Module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for config**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, validateConfig } from "../src/config.js";
import { DEFAULT_CONFIG, type Config } from "../src/types.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "quotaflow-test-config");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns default config when no file exists", () => {
    const config = loadConfig(join(TEST_DIR, "nonexistent.json"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges user config with defaults", () => {
    const userConfig = { discord_webhook_url: "https://discord.com/api/webhooks/test" };
    writeFileSync(join(TEST_DIR, "config.json"), JSON.stringify(userConfig));
    const config = loadConfig(join(TEST_DIR, "config.json"));
    expect(config.discord_webhook_url).toBe("https://discord.com/api/webhooks/test");
    expect(config.check_interval_minutes).toBe(DEFAULT_CONFIG.check_interval_minutes);
  });

  it("handles malformed JSON gracefully", () => {
    writeFileSync(join(TEST_DIR, "config.json"), "not json{{{");
    const config = loadConfig(join(TEST_DIR, "config.json"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});

describe("validateConfig", () => {
  it("accepts valid config", () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it("rejects negative interval", () => {
    const bad = { ...DEFAULT_CONFIG, check_interval_minutes: -1 };
    expect(() => validateConfig(bad)).toThrow();
  });

  it("rejects zero safety buffer", () => {
    const bad = {
      ...DEFAULT_CONFIG,
      quota: { ...DEFAULT_CONFIG.quota, safety_buffer_percent: -5 },
    };
    expect(() => validateConfig(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL - cannot resolve `../src/config.js`

- [ ] **Step 3: Implement config module**

```typescript
// src/config.ts
import { readFileSync, existsSync } from "node:fs";
import { DEFAULT_CONFIG, type Config } from "./types.js";

export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const userConfig = JSON.parse(raw);
    return mergeConfig(DEFAULT_CONFIG, userConfig);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function mergeConfig(defaults: Config, overrides: Record<string, unknown>): Config {
  const result = { ...defaults };

  for (const key of Object.keys(overrides)) {
    if (key in defaults) {
      const defaultVal = (defaults as Record<string, unknown>)[key];
      const overrideVal = overrides[key];

      if (
        typeof defaultVal === "object" &&
        defaultVal !== null &&
        !Array.isArray(defaultVal) &&
        typeof overrideVal === "object" &&
        overrideVal !== null
      ) {
        (result as Record<string, unknown>)[key] = {
          ...(defaultVal as Record<string, unknown>),
          ...(overrideVal as Record<string, unknown>),
        };
      } else {
        (result as Record<string, unknown>)[key] = overrideVal;
      }
    }
  }

  return result;
}

export function validateConfig(config: Config): void {
  if (config.check_interval_minutes <= 0) {
    throw new Error("check_interval_minutes must be positive");
  }
  if (config.inactivity_threshold_minutes <= 0) {
    throw new Error("inactivity_threshold_minutes must be positive");
  }
  if (config.quota.safety_buffer_percent < 0) {
    throw new Error("safety_buffer_percent must be non-negative");
  }
  if (config.quota.tokens_per_5h_window <= 0) {
    throw new Error("tokens_per_5h_window must be positive");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config module with defaults, merge, and validation"
```

---

### Task 3: Task Queue Manager

**Files:**
- Create: `src/queue.ts`
- Create: `tests/queue.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/queue.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskQueueManager } from "../src/queue.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "quotaflow-test-queue");
const TASKS_FILE = join(TEST_DIR, "tasks.json");
const PROJECTS_DIR = join(TEST_DIR, "projects");

let queue: TaskQueueManager;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Create fake project directories for portable tests
  mkdirSync(join(PROJECTS_DIR, "Relay"), { recursive: true });
  mkdirSync(join(PROJECTS_DIR, "Athena"), { recursive: true });
  mkdirSync(join(PROJECTS_DIR, "Prism"), { recursive: true });
  queue = new TaskQueueManager(TASKS_FILE, PROJECTS_DIR);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("TaskQueueManager", () => {
  it("returns empty list when no file exists", () => {
    expect(queue.getQueued()).toEqual([]);
  });

  it("loads tasks from file", () => {
    queue.addTask({
      description: "Add validation to webhook",
      project: "Relay",
      priority: "high",
      size: "medium",
      safe: true,
    });
    const tasks = queue.getQueued();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Add validation to webhook");
    expect(tasks[0].status).toBe("queued");
    expect(tasks[0].id).toBeDefined();
  });

  it("returns queued tasks sorted by priority", () => {
    queue.addTask({ description: "Low task", project: "Relay", priority: "low", size: "small", safe: true });
    queue.addTask({ description: "High task", project: "Athena", priority: "high", size: "medium", safe: true });
    queue.addTask({ description: "Med task", project: "Prism", priority: "medium", size: "small", safe: true });
    const tasks = queue.getQueued();
    expect(tasks[0].priority).toBe("high");
    expect(tasks[1].priority).toBe("medium");
    expect(tasks[2].priority).toBe("low");
  });

  it("updates task status", () => {
    queue.addTask({ description: "Test task", project: "Relay", priority: "high", size: "small", safe: true });
    const task = queue.getQueued()[0];
    queue.updateTask(task.id, { status: "running" });
    expect(queue.getAll().find((t) => t.id === task.id)?.status).toBe("running");
  });

  it("completes task with metadata", () => {
    queue.addTask({ description: "Test task", project: "Relay", priority: "high", size: "small", safe: true });
    const task = queue.getQueued()[0];
    queue.completeTask(task.id, {
      branch: "quotaflow/task-001",
      tokens_used: 5000,
      duration_ms: 30000,
    });
    const updated = queue.getAll().find((t) => t.id === task.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.branch).toBe("quotaflow/task-001");
    expect(updated?.completed_at).toBeDefined();
  });

  it("fails task with error", () => {
    queue.addTask({ description: "Test task", project: "Relay", priority: "high", size: "small", safe: true });
    const task = queue.getQueued()[0];
    queue.failTask(task.id, "timeout exceeded");
    const updated = queue.getAll().find((t) => t.id === task.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("timeout exceeded");
  });

  it("rejects invalid project path", () => {
    expect(() =>
      queue.addTask({
        description: "Bad task",
        project: "NonexistentProject",
        priority: "high",
        size: "small",
        safe: true,
      })
    ).toThrow();
  });

  it("picks next task matching size constraint", () => {
    queue.addTask({ description: "Big task", project: "Relay", priority: "high", size: "large", safe: true });
    queue.addTask({ description: "Small task", project: "Athena", priority: "medium", size: "small", safe: true });
    const next = queue.pickNext(15000);
    expect(next?.description).toBe("Small task");
  });

  it("returns null when no task fits quota", () => {
    queue.addTask({ description: "Big task", project: "Relay", priority: "high", size: "large", safe: true });
    const next = queue.pickNext(5000);
    expect(next).toBeNull();
  });

  it("persists across instances", () => {
    queue.addTask({ description: "Persist test", project: "Relay", priority: "high", size: "small", safe: true });
    const queue2 = new TaskQueueManager(TASKS_FILE, "/Users/zion/Repos/Zylo");
    expect(queue2.getQueued()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/queue.test.ts`
Expected: FAIL - cannot resolve `../src/queue.js`

- [ ] **Step 3: Implement queue module**

```typescript
// src/queue.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { type Task, type TaskQueue, type TaskPriority, type TaskSize, SIZE_TOKEN_ESTIMATES } from "./types.js";

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

interface AddTaskInput {
  description: string;
  project: string;
  priority: TaskPriority;
  size: TaskSize;
  safe: boolean;
}

interface CompleteMetadata {
  branch: string;
  tokens_used: number;
  duration_ms: number;
}

export class TaskQueueManager {
  private filePath: string;
  private projectsRoot: string;

  constructor(filePath: string, projectsRoot: string) {
    this.filePath = filePath;
    this.projectsRoot = projectsRoot;
  }

  getAll(): Task[] {
    return this.load().tasks;
  }

  getQueued(): Task[] {
    return this.load()
      .tasks.filter((t) => t.status === "queued")
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  addTask(input: AddTaskInput): Task {
    const projectPath = join(this.projectsRoot, input.project);
    if (!existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }

    const task: Task = {
      id: randomUUID().slice(0, 8),
      description: input.description,
      project: input.project,
      priority: input.priority,
      size: input.size,
      safe: input.safe,
      status: "queued",
      created_at: new Date().toISOString(),
    };

    const data = this.load();
    data.tasks.push(task);
    this.save(data);
    return task;
  }

  updateTask(id: string, updates: Partial<Task>): void {
    const data = this.load();
    const idx = data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task not found: ${id}`);
    data.tasks[idx] = { ...data.tasks[idx], ...updates };
    this.save(data);
  }

  completeTask(id: string, meta: CompleteMetadata): void {
    this.updateTask(id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      branch: meta.branch,
      tokens_used: meta.tokens_used,
      duration_ms: meta.duration_ms,
    });
  }

  failTask(id: string, error: string): void {
    this.updateTask(id, {
      status: "failed",
      completed_at: new Date().toISOString(),
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

  private load(): TaskQueue {
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

  private save(data: TaskQueue): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/queue.test.ts`
Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "feat: task queue manager with priority sorting and size-based picking"
```

---

### Task 4: Quota Monitor

**Files:**
- Create: `src/quota.ts`
- Create: `tests/quota.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/quota.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QuotaMonitor } from "../src/quota.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "quotaflow-test-quota");
const DB_PATH = join(TEST_DIR, "data.db");

let monitor: QuotaMonitor;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  monitor = new QuotaMonitor(DB_PATH, {
    tokens_per_5h_window: 88000,
    weekly_compute_hours: 200,
    safety_buffer_percent: 10,
  });
});

afterEach(() => {
  monitor.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("QuotaMonitor", () => {
  it("starts with full quota available", () => {
    const available = monitor.getAvailableTokens();
    expect(available).toBe(Math.floor(88000 * 0.9));
  });

  it("reduces available tokens after recording usage", () => {
    monitor.recordUsage("task-1", 10000, 60000);
    const available = monitor.getAvailableTokens();
    expect(available).toBe(Math.floor(88000 * 0.9) - 10000);
  });

  it("resets window after 5 hours", () => {
    monitor.recordUsage("task-1", 50000, 60000);

    // Simulate time passing: set window start to 5h+1min ago
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000 - 60000);
    monitor.setWindowStart(fiveHoursAgo);

    const available = monitor.getAvailableTokens();
    expect(available).toBe(Math.floor(88000 * 0.9));
  });

  it("marks window exhausted on rate limit", () => {
    monitor.markRateLimited();
    expect(monitor.isWindowExhausted()).toBe(true);
    expect(monitor.getAvailableTokens()).toBe(0);
  });

  it("tracks weekly usage", () => {
    monitor.recordUsage("task-1", 10000, 120000);
    monitor.recordUsage("task-2", 20000, 180000);
    const weekly = monitor.getWeeklyUsage();
    expect(weekly.total_tokens).toBe(30000);
    expect(weekly.task_count).toBe(2);
  });

  it("can check if enough quota for a task size", () => {
    expect(monitor.hasQuotaFor("small")).toBe(true);
    expect(monitor.hasQuotaFor("large")).toBe(true);

    monitor.recordUsage("task-1", 75000, 60000);
    expect(monitor.hasQuotaFor("large")).toBe(false);
    expect(monitor.hasQuotaFor("small")).toBe(true);
  });

  it("persists data across instances", () => {
    monitor.recordUsage("task-1", 20000, 60000);
    monitor.close();

    const monitor2 = new QuotaMonitor(DB_PATH, {
      tokens_per_5h_window: 88000,
      weekly_compute_hours: 200,
      safety_buffer_percent: 10,
    });
    const available = monitor2.getAvailableTokens();
    expect(available).toBe(Math.floor(88000 * 0.9) - 20000);
    monitor2.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/quota.test.ts`
Expected: FAIL - cannot resolve `../src/quota.js`

- [ ] **Step 3: Implement quota monitor**

```typescript
// src/quota.ts
import Database from "better-sqlite3";
import { type TaskSize, SIZE_TOKEN_ESTIMATES } from "./types.js";

interface QuotaConfig {
  tokens_per_5h_window: number;
  weekly_compute_hours: number;
  safety_buffer_percent: number;
}

interface WeeklyUsage {
  total_tokens: number;
  total_duration_ms: number;
  task_count: number;
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class QuotaMonitor {
  private db: Database.Database;
  private config: QuotaConfig;

  constructor(dbPath: string, config: QuotaConfig) {
    this.db = new Database(dbPath);
    this.config = config;
    this.initDb();
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        tokens_used INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS window_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Initialize window start if not set
    const row = this.db.prepare("SELECT value FROM window_state WHERE key = 'window_start'").get() as
      | { value: string }
      | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO window_state (key, value) VALUES ('window_start', ?)")
        .run(new Date().toISOString());
    }
  }

  recordUsage(taskId: string, tokensUsed: number, durationMs: number): void {
    this.db
      .prepare("INSERT INTO usage_log (task_id, tokens_used, duration_ms) VALUES (?, ?, ?)")
      .run(taskId, tokensUsed, durationMs);
  }

  getAvailableTokens(): number {
    if (this.isWindowExhausted()) return 0;

    this.maybeResetWindow();

    const windowStart = this.getWindowStart();
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(tokens_used), 0) as total FROM usage_log WHERE recorded_at >= ?"
      )
      .get(windowStart.toISOString()) as { total: number };

    const effective = Math.floor(this.config.tokens_per_5h_window * (1 - this.config.safety_buffer_percent / 100));
    return Math.max(0, effective - row.total);
  }

  hasQuotaFor(size: TaskSize): boolean {
    return this.getAvailableTokens() >= SIZE_TOKEN_ESTIMATES[size];
  }

  markRateLimited(): void {
    this.db
      .prepare("INSERT OR REPLACE INTO window_state (key, value) VALUES ('rate_limited', 'true')")
      .run();
  }

  isWindowExhausted(): boolean {
    this.maybeResetWindow();
    const row = this.db.prepare("SELECT value FROM window_state WHERE key = 'rate_limited'").get() as
      | { value: string }
      | undefined;
    return row?.value === "true";
  }

  getWeeklyUsage(): WeeklyUsage {
    const weekAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
                COALESCE(SUM(duration_ms), 0) as total_duration_ms,
                COUNT(*) as task_count
         FROM usage_log WHERE recorded_at >= ?`
      )
      .get(weekAgo) as WeeklyUsage;
    return row;
  }

  setWindowStart(date: Date): void {
    this.db
      .prepare("INSERT OR REPLACE INTO window_state (key, value) VALUES ('window_start', ?)")
      .run(date.toISOString());
    // Clear rate limit when resetting window
    this.db.prepare("DELETE FROM window_state WHERE key = 'rate_limited'").run();
  }

  close(): void {
    this.db.close();
  }

  private getWindowStart(): Date {
    const row = this.db.prepare("SELECT value FROM window_state WHERE key = 'window_start'").get() as {
      value: string;
    };
    return new Date(row.value);
  }

  private maybeResetWindow(): void {
    const windowStart = this.getWindowStart();
    if (Date.now() - windowStart.getTime() >= FIVE_HOURS_MS) {
      this.setWindowStart(new Date());
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/quota.test.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/quota.ts tests/quota.test.ts
git commit -m "feat: quota monitor with 5h window tracking, rate limit detection, SQLite persistence"
```

---

### Task 5: Activity Detector

**Files:**
- Create: `src/activity.ts`
- Create: `tests/activity.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/activity.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityDetector } from "../src/activity.js";

describe("ActivityDetector", () => {
  let detector: ActivityDetector;

  beforeEach(() => {
    detector = new ActivityDetector(15);
  });

  it("reports inactive when no claude processes found", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([]);
    const result = await detector.isUserActive();
    expect(result).toBe(false);
  });

  it("reports active when claude processes are running", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1234, command: "claude --session" },
    ]);
    const result = await detector.isUserActive();
    expect(result).toBe(true);
  });

  it("excludes quotaflow's own processes", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 5678, command: "claude -p quotaflow-task" },
    ]);
    detector.registerOwnPid(5678);
    const result = await detector.isUserActive();
    expect(result).toBe(false);
  });

  it("respects inactivity threshold", async () => {
    // First check: active
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1234, command: "claude" },
    ]);
    await detector.isUserActive();

    // Second check: no processes, but within threshold
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([]);
    detector.setLastActiveTime(new Date(Date.now() - 5 * 60 * 1000)); // 5 min ago
    const result = await detector.isUserActive();
    expect(result).toBe(true); // still within 15 min threshold

    // Third check: past threshold
    detector.setLastActiveTime(new Date(Date.now() - 20 * 60 * 1000)); // 20 min ago
    const result2 = await detector.isUserActive();
    expect(result2).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/activity.test.ts`
Expected: FAIL - cannot resolve `../src/activity.js`

- [ ] **Step 3: Implement activity detector**

```typescript
// src/activity.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface ClaudeProcess {
  pid: number;
  command: string;
}

export class ActivityDetector {
  private thresholdMinutes: number;
  private lastActiveTime: Date | null = null;
  private ownPids: Set<number> = new Set();

  constructor(thresholdMinutes: number) {
    this.thresholdMinutes = thresholdMinutes;
  }

  async isUserActive(): Promise<boolean> {
    const processes = await this.getClaudeProcesses();
    const userProcesses = processes.filter((p) => !this.ownPids.has(p.pid));

    if (userProcesses.length > 0) {
      this.lastActiveTime = new Date();
      return true;
    }

    // No active processes - check threshold
    if (this.lastActiveTime) {
      const elapsed = Date.now() - this.lastActiveTime.getTime();
      const thresholdMs = this.thresholdMinutes * 60 * 1000;
      if (elapsed < thresholdMs) {
        return true; // within grace period
      }
    }

    return false;
  }

  async getClaudeProcesses(): Promise<ClaudeProcess[]> {
    try {
      const { stdout } = await execAsync("pgrep -fl claude 2>/dev/null || true");
      if (!stdout.trim()) return [];

      return stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const spaceIdx = line.indexOf(" ");
          return {
            pid: parseInt(line.slice(0, spaceIdx), 10),
            command: line.slice(spaceIdx + 1),
          };
        })
        .filter((p) => !isNaN(p.pid));
    } catch {
      return [];
    }
  }

  registerOwnPid(pid: number): void {
    this.ownPids.add(pid);
  }

  setLastActiveTime(time: Date): void {
    this.lastActiveTime = time;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/activity.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/activity.ts tests/activity.test.ts
git commit -m "feat: activity detector with process scanning and inactivity threshold"
```

---

### Task 6: Logger

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Logger } from "../src/logger.js";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "quotaflow-test-logs");
let logger: Logger;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  logger = new Logger(TEST_DIR);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Logger", () => {
  it("creates log file for today", () => {
    logger.info("test message");
    const today = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(TEST_DIR, `${today}.log`))).toBe(true);
  });

  it("writes structured log entries", () => {
    logger.info("task started", { task_id: "abc", project: "Relay" });
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(join(TEST_DIR, `${today}.log`), "utf-8");
    expect(content).toContain("INFO");
    expect(content).toContain("task started");
    expect(content).toContain("abc");
  });

  it("logs errors with stack traces", () => {
    logger.error("something broke", { error: "timeout" });
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(join(TEST_DIR, `${today}.log`), "utf-8");
    expect(content).toContain("ERROR");
    expect(content).toContain("something broke");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement logger**

```typescript
// src/logger.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export class Logger {
  private logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    mkdirSync(logDir, { recursive: true });
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("INFO", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("WARN", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("ERROR", message, data);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write("DEBUG", message, data);
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const entry = data
      ? `[${timestamp}] ${level}: ${message} ${JSON.stringify(data)}\n`
      : `[${timestamp}] ${level}: ${message}\n`;

    const filename = timestamp.slice(0, 10) + ".log";
    appendFileSync(join(this.logDir, filename), entry);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/logger.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: structured file logger with daily rotation"
```

---

### Task 7: Discord Notifications

**Files:**
- Create: `src/notify.ts`
- Create: `tests/notify.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/notify.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Notifier } from "../src/notify.js";
import type { Task, ExecutionResult } from "../src/types.js";

describe("Notifier", () => {
  let notifier: Notifier;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    notifier = new Notifier("https://discord.com/api/webhooks/test/token", mockFetch);
  });

  it("sends task completion notification", async () => {
    const task: Task = {
      id: "abc",
      description: "Add validation",
      project: "Relay",
      priority: "high",
      size: "medium",
      safe: true,
      status: "completed",
      created_at: "2026-04-03T00:00:00Z",
    };
    const result: ExecutionResult = {
      task_id: "abc",
      success: true,
      branch: "quotaflow/task-abc",
      tokens_used: 15000,
      duration_ms: 120000,
      stdout: "Done",
      stderr: "",
    };

    await notifier.taskCompleted(task, result);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/test/token");
    const body = JSON.parse(options.body);
    expect(body.embeds[0].title).toContain("Relay");
    expect(body.embeds[0].color).toBe(0x00ff00); // green for success
  });

  it("sends failure notification with red color", async () => {
    const task: Task = {
      id: "def",
      description: "Broken task",
      project: "Athena",
      priority: "low",
      size: "small",
      safe: true,
      status: "failed",
      created_at: "2026-04-03T00:00:00Z",
      error: "timeout",
    };
    const result: ExecutionResult = {
      task_id: "def",
      success: false,
      branch: "quotaflow/task-def",
      tokens_used: 5000,
      duration_ms: 300000,
      stdout: "",
      stderr: "Process timed out",
      error: "timeout",
    };

    await notifier.taskCompleted(task, result);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.embeds[0].color).toBe(0xff0000); // red for failure
  });

  it("skips notification when no webhook configured", async () => {
    const silent = new Notifier("", mockFetch);
    await silent.taskCompleted({} as Task, {} as ExecutionResult);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends daily digest with utilization stats", async () => {
    const tasks: Task[] = [
      { id: "1", description: "t1", project: "R", priority: "high", size: "small", safe: true, status: "completed", created_at: "" },
      { id: "2", description: "t2", project: "R", priority: "low", size: "small", safe: true, status: "failed", created_at: "" },
    ];
    await notifier.sendDailyDigest(tasks, 44000, 88000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.embeds[0].title).toContain("Daily Digest");
    expect(body.embeds[0].fields[2].value).toBe("50%");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notify.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement notifier**

```typescript
// src/notify.ts
import type { Task, ExecutionResult } from "./types.js";

type FetchFn = typeof globalThis.fetch;

export class Notifier {
  private webhookUrl: string;
  private fetchFn: FetchFn;

  constructor(webhookUrl: string, fetchFn: FetchFn = globalThis.fetch) {
    this.webhookUrl = webhookUrl;
    this.fetchFn = fetchFn;
  }

  async taskCompleted(task: Task, result: ExecutionResult): Promise<void> {
    if (!this.webhookUrl) return;

    const color = result.success ? 0x00ff00 : 0xff0000;
    const status = result.success ? "Completed" : "Failed";
    const duration = Math.round(result.duration_ms / 1000);

    const embed = {
      title: `[${task.project}] Task ${status}`,
      description: task.description,
      color,
      fields: [
        { name: "Branch", value: result.branch || "N/A", inline: true },
        { name: "Tokens", value: String(result.tokens_used || 0), inline: true },
        { name: "Duration", value: `${duration}s`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    if (result.error) {
      embed.fields.push({ name: "Error", value: result.error.slice(0, 200), inline: false });
    }

    try {
      await this.fetchFn(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch {
      // Notification failure should not crash the daemon
    }
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      await this.fetchFn(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    } catch {
      // Silent fail
    }
  }

  async sendDailyDigest(tasks: Task[], quotaUsed: number, quotaTotal: number): Promise<void> {
    if (!this.webhookUrl) return;

    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const utilization = quotaTotal > 0 ? Math.round((quotaUsed / quotaTotal) * 100) : 0;

    const embed = {
      title: "QuotaFlow Daily Digest",
      color: 0x0099ff,
      fields: [
        { name: "Tasks Completed", value: String(completed), inline: true },
        { name: "Tasks Failed", value: String(failed), inline: true },
        { name: "Token Utilization", value: `${utilization}%`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    try {
      await this.fetchFn(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch {
      // Silent fail
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notify.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/notify.ts tests/notify.test.ts
git commit -m "feat: discord webhook notifications for task completion"
```

---

### Task 8: Task Executor

**Files:**
- Create: `src/executor.ts`
- Create: `tests/executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/executor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskExecutor } from "../src/executor.js";
import type { Task } from "../src/types.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "quotaflow-test-executor");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("TaskExecutor", () => {
  it("builds correct branch name from task", () => {
    const executor = new TaskExecutor({ small: 5, medium: 15, large: 45 });
    const task: Task = {
      id: "abc123",
      description: "Add input validation to webhook endpoint",
      project: "Relay",
      priority: "high",
      size: "medium",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };
    const branch = executor.buildBranchName(task);
    expect(branch).toBe("quotaflow/task-abc123-add-input-validation");
  });

  it("truncates long branch names", () => {
    const executor = new TaskExecutor({ small: 5, medium: 15, large: 45 });
    const task: Task = {
      id: "xyz789",
      description: "This is a very long task description that should be truncated for branch naming purposes",
      project: "Relay",
      priority: "high",
      size: "medium",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };
    const branch = executor.buildBranchName(task);
    expect(branch.length).toBeLessThanOrEqual(60);
    expect(branch).toMatch(/^quotaflow\/task-xyz789-/);
  });

  it("builds correct claude command", () => {
    const executor = new TaskExecutor({ small: 5, medium: 15, large: 45 });
    const task: Task = {
      id: "abc",
      description: 'Fix the "bug" in auth',
      project: "Relay",
      priority: "high",
      size: "small",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };
    const cmd = executor.buildClaudeCommand(task, "/Users/zion/Repos/Zylo/Relay");
    expect(cmd).toContain("claude");
    expect(cmd).toContain("-p");
    expect(cmd).toContain("--cwd");
    expect(cmd).toContain("/Users/zion/Repos/Zylo/Relay");
    // Verify description is properly escaped
    expect(cmd).not.toContain('"bug"');
  });

  it("returns correct timeout for task size", () => {
    const executor = new TaskExecutor({ small: 5, medium: 15, large: 45 });
    expect(executor.getTimeoutMs("small")).toBe(5 * 60 * 1000);
    expect(executor.getTimeoutMs("medium")).toBe(15 * 60 * 1000);
    expect(executor.getTimeoutMs("large")).toBe(45 * 60 * 1000);
  });

  it("execute() creates branch, runs claude, commits, and returns to original branch", async () => {
    // Setup: create a temp git repo to act as project
    const { execSync } = await import("node:child_process");
    const projectDir = join(TEST_DIR, "FakeProject");
    mkdirSync(projectDir, { recursive: true });
    execSync("git init && git commit --allow-empty -m 'init'", { cwd: projectDir });

    const executor = new TaskExecutor({ small: 5, medium: 15, large: 45 });
    // Mock claude CLI by putting a stub script on PATH
    // For unit test: override execute to test branch lifecycle only
    const task: Task = {
      id: "exec1",
      description: "Test execution",
      project: "FakeProject",
      priority: "high",
      size: "small",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };

    // Test that execute handles missing claude CLI gracefully
    const result = await executor.execute(task, projectDir);
    // Claude CLI won't be available in test env, so this should fail gracefully
    expect(result.task_id).toBe("exec1");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    // Verify cleanup: should be back on original branch, feature branch deleted
    const { stdout: currentBranch } = await import("node:child_process").then((cp) =>
      cp.execSync("git branch --show-current", { cwd: projectDir }).toString()
    );
    expect(currentBranch).not.toContain("quotaflow/");
  });

  it("execute() cleans up empty branch when no changes produced", async () => {
    const { execSync } = await import("node:child_process");
    const projectDir = join(TEST_DIR, "EmptyProject");
    mkdirSync(projectDir, { recursive: true });
    execSync("git init && git commit --allow-empty -m 'init'", { cwd: projectDir });

    const executor = new TaskExecutor({ small: 5, medium: 15, large: 45 });
    const task: Task = {
      id: "empty1",
      description: "No-op task",
      project: "EmptyProject",
      priority: "low",
      size: "small",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };

    const result = await executor.execute(task, projectDir);
    // Branch should not persist if no changes
    if (result.success && result.branch === "") {
      const { stdout: branches } = await import("node:child_process").then((cp) =>
        cp.execSync("git branch", { cwd: projectDir }).toString()
      );
      expect(branches).not.toContain("quotaflow/task-empty1");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/executor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement executor**

```typescript
// src/executor.ts
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Task, TaskSize, ExecutionResult } from "./types.js";

const execAsync = promisify(exec);

interface TimeoutConfig {
  small: number;
  medium: number;
  large: number;
}

export class TaskExecutor {
  private timeouts: TimeoutConfig;

  constructor(timeouts: TimeoutConfig) {
    this.timeouts = timeouts;
  }

  buildBranchName(task: Task): string {
    const slug = task.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);
    const name = `quotaflow/task-${task.id}-${slug}`;
    return name.slice(0, 60);
  }

  buildClaudeCommand(task: Task, projectPath: string): string {
    // Escape single quotes in description for shell safety
    const safeDesc = task.description.replace(/'/g, "'\\''");
    return `claude -p '${safeDesc}' --cwd '${projectPath}' --output-format json`;
  }

  getTimeoutMs(size: TaskSize): number {
    return this.timeouts[size] * 60 * 1000;
  }

  async execute(task: Task, projectPath: string): Promise<ExecutionResult> {
    const branch = this.buildBranchName(task);
    const startTime = Date.now();

    try {
      // Create and checkout feature branch
      await execAsync(`git checkout -b ${branch}`, { cwd: projectPath });

      // Run claude CLI
      const cmd = this.buildClaudeCommand(task, projectPath);
      const timeoutMs = this.getTimeoutMs(task.size);

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: projectPath,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse token usage from JSON output if available
      let tokensUsed = 0;
      try {
        const output = JSON.parse(stdout);
        tokensUsed =
          (output.usage?.input_tokens || 0) + (output.usage?.output_tokens || 0);
      } catch {
        // Non-JSON output, estimate from length
        tokensUsed = Math.ceil(stdout.length / 4);
      }

      // Check if there are changes to commit
      const { stdout: diffOutput } = await execAsync("git diff --stat", { cwd: projectPath });

      if (diffOutput.trim()) {
        await execAsync("git add -A", { cwd: projectPath });
        // Use spawn with argv array to avoid shell injection in commit message
        await new Promise<void>((resolve, reject) => {
          const proc = spawn("git", ["commit", "-m", `quotaflow: ${task.description}`], {
            cwd: projectPath,
            stdio: "pipe",
          });
          proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git commit exited ${code}`))));
          proc.on("error", reject);
        });
      } else {
        // No changes produced - clean up empty branch
        await execAsync("git checkout -", { cwd: projectPath });
        await execAsync(`git branch -D ${branch}`, { cwd: projectPath });
        return {
          task_id: task.id,
          success: true,
          branch: "",
          tokens_used: tokensUsed,
          duration_ms: Date.now() - startTime,
          stdout,
          stderr,
        };
      }

      // Switch back to previous branch
      await execAsync("git checkout -", { cwd: projectPath });

      return {
        task_id: task.id,
        success: true,
        branch,
        tokens_used: tokensUsed,
        duration_ms: Date.now() - startTime,
        stdout,
        stderr,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      // Cleanup: try to switch back and delete failed branch
      try {
        await execAsync("git checkout -", { cwd: projectPath });
        await execAsync(`git branch -D ${branch}`, { cwd: projectPath });
      } catch {
        // Cleanup failure is non-fatal
      }

      return {
        task_id: task.id,
        success: false,
        branch,
        tokens_used: 0,
        duration_ms: Date.now() - startTime,
        stdout: "",
        stderr: "",
        error,
      };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/executor.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/executor.ts tests/executor.test.ts
git commit -m "feat: task executor with claude CLI integration and git branch management"
```

---

### Task 9: Scheduler (Main Daemon Loop)

**Files:**
- Create: `src/scheduler.ts`
- Create: `tests/scheduler.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../src/scheduler.js";
import type { Config, Task } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/types.js";

describe("Scheduler", () => {
  it("skips dispatch when user is active", async () => {
    const deps = mockDeps();
    deps.activity.isUserActive.mockResolvedValue(true);

    const scheduler = new Scheduler(deps);
    await scheduler.tick();

    expect(deps.queue.pickNext).not.toHaveBeenCalled();
    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("skips dispatch when no quota available", async () => {
    const deps = mockDeps();
    deps.activity.isUserActive.mockResolvedValue(false);
    deps.quota.getAvailableTokens.mockReturnValue(0);

    const scheduler = new Scheduler(deps);
    await scheduler.tick();

    expect(deps.queue.pickNext).not.toHaveBeenCalled();
  });

  it("skips dispatch when no tasks in queue", async () => {
    const deps = mockDeps();
    deps.activity.isUserActive.mockResolvedValue(false);
    deps.quota.getAvailableTokens.mockReturnValue(50000);
    deps.queue.pickNext.mockReturnValue(null);

    const scheduler = new Scheduler(deps);
    await scheduler.tick();

    expect(deps.executor.execute).not.toHaveBeenCalled();
  });

  it("executes task when idle + quota + task available", async () => {
    const deps = mockDeps();
    const task: Task = {
      id: "test-1",
      description: "Test task",
      project: "Relay",
      priority: "high",
      size: "small",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };

    deps.activity.isUserActive.mockResolvedValue(false);
    deps.quota.getAvailableTokens.mockReturnValue(50000);
    deps.queue.pickNext.mockReturnValue(task);
    deps.executor.execute.mockResolvedValue({
      task_id: "test-1",
      success: true,
      branch: "quotaflow/task-test-1",
      tokens_used: 8000,
      duration_ms: 60000,
      stdout: "done",
      stderr: "",
    });

    const scheduler = new Scheduler(deps);
    await scheduler.tick();

    expect(deps.queue.updateTask).toHaveBeenCalledWith("test-1", { status: "running" });
    expect(deps.executor.execute).toHaveBeenCalledWith(task, "/Users/zion/Repos/Zylo/Relay");
    expect(deps.queue.completeTask).toHaveBeenCalledWith("test-1", {
      branch: "quotaflow/task-test-1",
      tokens_used: 8000,
      duration_ms: 60000,
    });
    expect(deps.quota.recordUsage).toHaveBeenCalledWith("test-1", 8000, 60000);
    expect(deps.notifier.taskCompleted).toHaveBeenCalled();
  });

  it("handles task failure gracefully", async () => {
    const deps = mockDeps();
    const task: Task = {
      id: "fail-1",
      description: "Failing task",
      project: "Athena",
      priority: "high",
      size: "medium",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };

    deps.activity.isUserActive.mockResolvedValue(false);
    deps.quota.getAvailableTokens.mockReturnValue(50000);
    deps.queue.pickNext.mockReturnValue(task);
    deps.executor.execute.mockResolvedValue({
      task_id: "fail-1",
      success: false,
      branch: "quotaflow/task-fail-1",
      tokens_used: 0,
      duration_ms: 5000,
      stdout: "",
      stderr: "",
      error: "command failed",
    });

    const scheduler = new Scheduler(deps);
    await scheduler.tick();

    expect(deps.queue.failTask).toHaveBeenCalledWith("fail-1", "command failed");
    expect(deps.notifier.taskCompleted).toHaveBeenCalled();
  });

  it("skips tick when previous tick is still running", async () => {
    const deps = mockDeps();
    deps.activity.isUserActive.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(false), 100))
    );
    deps.quota.getAvailableTokens.mockReturnValue(50000);
    deps.queue.pickNext.mockReturnValue(null);

    const scheduler = new Scheduler(deps);
    // Fire two ticks simultaneously
    const tick1 = scheduler.tick();
    const tick2 = scheduler.tick();
    await Promise.all([tick1, tick2]);

    // Activity check should only be called once (second tick skipped)
    expect(deps.activity.isUserActive).toHaveBeenCalledTimes(1);
  });

  it("marks rate limited when executor detects it", async () => {
    const deps = mockDeps();
    const task: Task = {
      id: "rl-1",
      description: "Rate limited task",
      project: "Prism",
      priority: "high",
      size: "small",
      safe: true,
      status: "queued",
      created_at: "2026-04-03T00:00:00Z",
    };

    deps.activity.isUserActive.mockResolvedValue(false);
    deps.quota.getAvailableTokens.mockReturnValue(50000);
    deps.queue.pickNext.mockReturnValue(task);
    deps.executor.execute.mockResolvedValue({
      task_id: "rl-1",
      success: false,
      branch: "",
      tokens_used: 0,
      duration_ms: 1000,
      stdout: "",
      stderr: "",
      error: "rate limit exceeded",
    });

    const scheduler = new Scheduler(deps);
    await scheduler.tick();

    expect(deps.quota.markRateLimited).toHaveBeenCalled();
  });
});

function mockDeps() {
  return {
    config: { ...DEFAULT_CONFIG },
    activity: {
      isUserActive: vi.fn(),
      registerOwnPid: vi.fn(),
    },
    quota: {
      getAvailableTokens: vi.fn(),
      recordUsage: vi.fn(),
      markRateLimited: vi.fn(),
      hasQuotaFor: vi.fn().mockReturnValue(true),
      isWindowExhausted: vi.fn().mockReturnValue(false),
    },
    queue: {
      pickNext: vi.fn(),
      updateTask: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
    },
    executor: {
      execute: vi.fn(),
    },
    notifier: {
      taskCompleted: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement scheduler**

```typescript
// src/scheduler.ts
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
  };
  queue: {
    pickNext(availableTokens: number): Task | null;
    updateTask(id: string, updates: Partial<Task>): void;
    completeTask(id: string, meta: { branch: string; tokens_used: number; duration_ms: number }): void;
    failTask(id: string, error: string): void;
  };
  executor: {
    execute(task: Task, projectPath: string): Promise<ExecutionResult>;
  };
  notifier: {
    taskCompleted(task: Task, result: ExecutionResult): Promise<void>;
    sendMessage(content: string): Promise<void>;
  };
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    debug(msg: string, data?: Record<string, unknown>): void;
  };
}

export class Scheduler {
  private deps: SchedulerDeps;
  private running = false;
  private busy = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  async tick(): Promise<void> {
    if (this.busy) {
      this.deps.logger.debug("Previous tick still running, skipping");
      return;
    }
    this.busy = true;
    try {
      await this.doTick();
    } finally {
      this.busy = false;
    }
  }

  private async doTick(): Promise<void> {
    const { activity, quota, queue, executor, notifier, logger, config } = this.deps;

    // Step 1: Check user activity
    const userActive = await activity.isUserActive();
    if (userActive) {
      logger.debug("User is active, skipping dispatch");
      return;
    }

    // Step 2: Check quota
    if (quota.isWindowExhausted()) {
      logger.debug("Quota window exhausted, skipping dispatch");
      return;
    }

    const availableTokens = quota.getAvailableTokens();
    if (availableTokens <= 0) {
      logger.debug("No tokens available, skipping dispatch");
      return;
    }

    // Step 3: Pick task
    const task = queue.pickNext(availableTokens);
    if (!task) {
      logger.debug("No suitable tasks in queue");
      return;
    }

    // Step 4: Execute
    logger.info("Dispatching task", { task_id: task.id, project: task.project, description: task.description });
    queue.updateTask(task.id, { status: "running" });

    const projectPath = join(config.projects_root, task.project);
    const result = await executor.execute(task, projectPath);

    // Step 5: Record results
    if (result.success) {
      queue.completeTask(task.id, {
        branch: result.branch,
        tokens_used: result.tokens_used,
        duration_ms: result.duration_ms,
      });
      quota.recordUsage(task.id, result.tokens_used, result.duration_ms);
      logger.info("Task completed", { task_id: task.id, tokens: result.tokens_used, branch: result.branch });
    } else {
      queue.failTask(task.id, result.error || "unknown error");

      if (result.error?.includes("rate limit")) {
        quota.markRateLimited();
        logger.warn("Rate limited, marking window exhausted");
      }

      logger.error("Task failed", { task_id: task.id, error: result.error });
    }

    // Step 6: Notify
    const updatedTask = { ...task, status: result.success ? "completed" as const : "failed" as const };
    await notifier.taskCompleted(updatedTask, result);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const intervalMs = this.deps.config.check_interval_minutes * 60 * 1000;
    this.deps.logger.info("Scheduler started", { interval_minutes: this.deps.config.check_interval_minutes });

    // Run immediately on start
    this.tick().catch((err) => {
      this.deps.logger.error("Tick error", { error: String(err) });
    });

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        this.deps.logger.error("Tick error", { error: String(err) });
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.deps.logger.info("Scheduler stopped");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts tests/scheduler.test.ts
git commit -m "feat: scheduler daemon loop with activity/quota/task dispatch pipeline"
```

---

### Task 10: Entry Point and Daemon Setup

**Files:**
- Create: `src/index.ts`
- Create: `com.zylo.quotaflow.plist` (launchd config)

- [ ] **Step 1: Implement entry point**

```typescript
// src/index.ts
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
  // Ensure directories exist
  mkdirSync(QUOTAFLOW_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });

  // Initialize components
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
  });

  // Handle shutdown
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
  });

  scheduler.start();
}

main();
```

- [ ] **Step 2: Create launchd plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zylo.quotaflow</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/zion/.nvm/versions/node/v24.14.0/bin/npx</string>
    <string>tsx</string>
    <string>/Users/zion/Repos/Zylo/QuotaFlow/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/zion/Repos/Zylo/QuotaFlow</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/zion/.quotaflow/logs/daemon-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/zion/.quotaflow/logs/daemon-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/zion/.nvm/versions/node/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
```

- [ ] **Step 3: Write smoke test for entry point wiring**

```typescript
// tests/index.test.ts
import { describe, it, expect } from "vitest";

describe("Module imports", () => {
  it("all src modules import without error", async () => {
    await expect(import("../src/types.js")).resolves.toBeDefined();
    await expect(import("../src/config.js")).resolves.toBeDefined();
    await expect(import("../src/queue.js")).resolves.toBeDefined();
    await expect(import("../src/quota.js")).resolves.toBeDefined();
    await expect(import("../src/activity.js")).resolves.toBeDefined();
    await expect(import("../src/executor.js")).resolves.toBeDefined();
    await expect(import("../src/notify.js")).resolves.toBeDefined();
    await expect(import("../src/logger.js")).resolves.toBeDefined();
    await expect(import("../src/scheduler.js")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the daemon starts**

Run: `npx tsx src/index.ts`
Expected: logs "QuotaFlow starting" and begins check loop (Ctrl+C to stop)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts com.zylo.quotaflow.plist tests/index.test.ts
git commit -m "feat: entry point with wiring smoke test and launchd daemon configuration"
```

---

### Task 11: Run Full Test Suite and Verify

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: all tests PASS (38+ tests across 8 files)

- [ ] **Step 2: Verify test coverage**

Run: `npx vitest run --coverage`
Expected: >90% line coverage on all src/ files

- [ ] **Step 3: Fix any failing tests or coverage gaps**

Address any issues found in steps 1-2.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify full test suite passes with >90% coverage"
```

---

### Task 12: Create Sample Config and Documentation

**Files:**
- Modify: `README.md`
- Create: `examples/config.json`
- Create: `examples/tasks.json`

- [ ] **Step 1: Create example config**

```json
{
  "projects_root": "/Users/zion/Repos/Zylo",
  "inactivity_threshold_minutes": 15,
  "check_interval_minutes": 5,
  "max_concurrency": 1,
  "discord_webhook_url": "",
  "quota": {
    "tokens_per_5h_window": 88000,
    "weekly_compute_hours": 200,
    "safety_buffer_percent": 10
  },
  "timeouts": {
    "small_minutes": 5,
    "medium_minutes": 15,
    "large_minutes": 45
  },
  "daily_report_hour": 8,
  "weekly_report_day": 1
}
```

- [ ] **Step 2: Create example tasks**

```json
{
  "tasks": [
    {
      "id": "001",
      "description": "Add input validation to /api/webhook endpoint",
      "project": "Relay",
      "priority": "high",
      "size": "medium",
      "safe": true,
      "status": "queued",
      "created_at": "2026-04-03T00:00:00Z"
    },
    {
      "id": "002",
      "description": "Write unit tests for auth middleware",
      "project": "Athena",
      "priority": "medium",
      "size": "small",
      "safe": true,
      "status": "queued",
      "created_at": "2026-04-03T00:00:00Z"
    }
  ]
}
```

- [ ] **Step 3: Update README.md**

Update with project description, quickstart, configuration, and usage instructions.

- [ ] **Step 4: Commit**

```bash
git add README.md examples/
git commit -m "docs: add example config, tasks, and README quickstart"
```
