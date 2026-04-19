import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramPoller } from "../src/telegram-poller.js";
import { TelegramState } from "../src/telegram-state.js";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Config, Task } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/types.js";

function makeConfig(projectsRoot: string): Config {
  return {
    ...DEFAULT_CONFIG,
    projects_roots: [projectsRoot],
    telegram_bot_token: "TOKEN",
    telegram_chat_id: "42",
    telegram_command_secret: "s3cr3t",
    default_size: "medium",
    default_priority: "medium",
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeQueue() {
  const tasks: Task[] = [];
  return {
    addTask: vi.fn((input) => {
      const t: Task = {
        id: `t${tasks.length + 1}`,
        description: input.description,
        project: input.project,
        priority: input.priority,
        size: input.size,
        status: "queued",
        created_at: new Date().toISOString(),
      };
      tasks.push(t);
      return t;
    }),
    getQueued: vi.fn(() => tasks.filter((t) => t.status === "queued")),
    updateTask: vi.fn((id: string, updates: Partial<Task>) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) throw new Error(`not found: ${id}`);
      Object.assign(t, updates);
      return t;
    }),
    _tasks: tasks,
  };
}

function makeQuota() {
  return { getAvailableTokens: vi.fn(() => 50000) };
}

/** Build a fake fetch that returns the given updates once, then empty forever. */
function makeFetchFn(updates: Array<Record<string, unknown>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let served = false;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/getUpdates")) {
      const body = served ? { ok: true, result: [] } : { ok: true, result: updates };
      served = true;
      return { ok: true, json: async () => body } as Response;
    }
    // sendMessage
    return { ok: true, json: async () => ({ ok: true, result: {} }) } as Response;
  });
  return { fn, calls };
}

describe("TelegramPoller", () => {
  let dir: string;
  let projectsRoot: string;
  let statePath: string;
  let BASE_CONFIG: Config;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qf-poller-"));
    projectsRoot = join(dir, "workspace");
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(join(projectsRoot, "MyApp"));
    mkdirSync(join(projectsRoot, "OtherApp"));
    statePath = join(dir, "s.json");
    BASE_CONFIG = makeConfig(projectsRoot);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects messages from wrong chat_id (silent drop)", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const logger = makeLogger();
    const { fn } = makeFetchFn([
      {
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: 999 },
          chat: { id: 999, type: "private" },
          text: "s3cr3t Fix bug",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger,
      fetchFn: fn as unknown as typeof fetch,
    });

    await poller.tick();

    expect(queue.addTask).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("chat_id mismatch"),
      expect.anything()
    );
  });

  it("rejects messages without correct passphrase", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const logger = makeLogger();
    const { fn } = makeFetchFn([
      {
        update_id: 2,
        message: {
          message_id: 11,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          text: "wrongsecret Fix bug",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger,
      fetchFn: fn as unknown as typeof fetch,
    });

    await poller.tick();

    expect(queue.addTask).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("passphrase mismatch")
    );
    // Must still mark as processed to prevent replay loop
    expect(state.isProcessed(11)).toBe(true);
  });

  it("enqueues task on valid passphrase + @Project prefix", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const logger = makeLogger();
    const { fn } = makeFetchFn([
      {
        update_id: 3,
        message: {
          message_id: 12,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          text: "s3cr3t @MyApp Fix login bug",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger,
      fetchFn: fn as unknown as typeof fetch,
    });

    await poller.tick();

    expect(queue.addTask).toHaveBeenCalledWith({
      description: "Fix login bug",
      project: "MyApp",
      priority: "medium",
      size: "medium",
    });
    expect(state.isProcessed(12)).toBe(true);
    expect(state.getLastUpdateId()).toBe(3);
  });

  it("rejects add without @Project or proj= (no default_project concept)", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const { fn, calls } = makeFetchFn([
      {
        update_id: 30,
        message: {
          message_id: 120,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          text: "s3cr3t Fix login bug",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger: makeLogger(),
      fetchFn: fn as unknown as typeof fetch,
    });
    await poller.tick();
    expect(queue.addTask).not.toHaveBeenCalled();
    const sendCall = calls.find((c) => c.url.includes("/sendMessage"));
    const body = JSON.parse((sendCall!.init!.body as string) || "{}");
    expect(body.text).toMatch(/No project specified/);
  });

  it("replies with candidates when fuzzy match is ambiguous or unknown", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const { fn, calls } = makeFetchFn([
      {
        update_id: 31,
        message: {
          message_id: 121,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          text: "s3cr3t @NonexistentApp Fix it",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger: makeLogger(),
      fetchFn: fn as unknown as typeof fetch,
    });
    await poller.tick();
    expect(queue.addTask).not.toHaveBeenCalled();
    const sendCall = calls.find((c) => c.url.includes("/sendMessage"));
    const body = JSON.parse((sendCall!.init!.body as string) || "{}");
    expect(body.text).toMatch(/Project not found/);
  });

  it("honors /add key=value overrides", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const { fn } = makeFetchFn([
      {
        update_id: 4,
        message: {
          message_id: 13,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          text: "s3cr3t /add proj=OtherApp size=large pri=high Big refactor",
          // OtherApp exists in projectsRoot per beforeEach
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger: makeLogger(),
      fetchFn: fn as unknown as typeof fetch,
    });

    await poller.tick();

    expect(queue.addTask).toHaveBeenCalledWith({
      description: "Big refactor",
      project: "OtherApp",
      priority: "high",
      size: "large",
    });
  });

  it("deduplicates same message_id across polls", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    // Mark 14 as already processed
    state.markProcessed(14);

    const { fn } = makeFetchFn([
      {
        update_id: 5,
        message: {
          message_id: 14,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          text: "s3cr3t Fix bug",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger: makeLogger(),
      fetchFn: fn as unknown as typeof fetch,
    });

    await poller.tick();
    expect(queue.addTask).not.toHaveBeenCalled();
  });

  it("finds project via fuzzy substring match", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const { fn } = makeFetchFn([
      {
        update_id: 6,
        message: {
          message_id: 15,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          // "oth" matches "OtherApp" via case-insensitive substring
          text: "s3cr3t @oth Fix substring match",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger: makeLogger(),
      fetchFn: fn as unknown as typeof fetch,
    });

    await poller.tick();
    expect(queue.addTask).toHaveBeenCalledWith(
      expect.objectContaining({ project: "OtherApp", description: "Fix substring match" })
    );
  });

  it("absolutely isolates errors: fetch throw does not propagate", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const logger = makeLogger();
    const fn = vi.fn(async () => {
      throw new Error("network down");
    });

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger,
      fetchFn: fn as unknown as typeof fetch,
    });

    await expect(poller.tick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("telegram poll failed"),
      expect.anything()
    );
  });

  it("does not start if credentials missing", () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const logger = makeLogger();
    const poller = new TelegramPoller({
      config: { ...BASE_CONFIG, telegram_bot_token: "" },
      state,
      queue,
      quota: makeQuota(),
      logger,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    poller.start();
    // No tick scheduled
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("telegram poller started"), expect.anything());
  });

  it("does not start if telegram_command_secret missing", () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    const logger = makeLogger();
    const poller = new TelegramPoller({
      config: { ...BASE_CONFIG, telegram_command_secret: "" },
      state,
      queue,
      quota: makeQuota(),
      logger,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    poller.start();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("telegram_command_secret is empty")
    );
  });

  it("processes /list correctly", async () => {
    const state = new TelegramState(statePath);
    const queue = makeQueue();
    // Pre-add a task so /list has data
    queue.addTask({ description: "existing task", project: "MyApp", priority: "medium", size: "small" });

    const { fn, calls } = makeFetchFn([
      {
        update_id: 7,
        message: {
          message_id: 16,
          from: { id: 42 },
          chat: { id: 42, type: "private" },
          text: "s3cr3t /list",
          date: Date.now() / 1000,
        },
      },
    ]);

    const poller = new TelegramPoller({
      config: BASE_CONFIG,
      state,
      queue,
      quota: makeQuota(),
      logger: makeLogger(),
      fetchFn: fn as unknown as typeof fetch,
    });

    await poller.tick();

    // Find the sendMessage call
    const sendCall = calls.find((c) => c.url.includes("/sendMessage"));
    expect(sendCall).toBeDefined();
    const body = JSON.parse((sendCall!.init!.body as string) || "{}");
    expect(body.text).toContain("existing task");
  });
});
