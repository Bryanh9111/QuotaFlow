import { describe, it, expect, vi } from "vitest";
import { TelegramNotifier, escapeMd2 } from "../src/telegram-notifier.js";
import type { Task, ExecutionResult } from "../src/types.js";

function makeFetch() {
  return vi.fn().mockResolvedValue({ ok: true });
}

const TOKEN = "123:abc";
const CHAT = "42";
const API_URL = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

const baseTask: Task = {
  id: "t1",
  description: "Fix login bug",
  project: "auth-service",
  priority: "high",
  size: "small",
  status: "completed",
  created_at: "2024-01-01T00:00:00Z",
  branch: "fix/login",
  tokens_used: 5000,
  duration_ms: 30000,
};

const successResult: ExecutionResult = {
  task_id: "t1",
  success: true,
  branch: "fix/login",
  tokens_used: 5000,
  duration_ms: 30000,
  stdout: "done",
  stderr: "",
};

const failResult: ExecutionResult = {
  task_id: "t1",
  success: false,
  branch: "fix/login",
  tokens_used: 1000,
  duration_ms: 5000,
  stdout: "",
  stderr: "error output",
  error: "Process exited with code 1",
};

describe("escapeMd2", () => {
  it("escapes all MarkdownV2 reserved characters", () => {
    expect(escapeMd2("a.b")).toBe("a\\.b");
    expect(escapeMd2("a-b")).toBe("a\\-b");
    expect(escapeMd2("(x)")).toBe("\\(x\\)");
    expect(escapeMd2("_*`")).toBe("\\_\\*\\`");
    expect(escapeMd2("a\\b")).toBe("a\\\\b");
  });

  it("leaves non-special chars intact", () => {
    expect(escapeMd2("hello world 123")).toBe("hello world 123");
  });
});

describe("TelegramNotifier", () => {
  describe("taskCompleted", () => {
    it("posts success message to correct URL with MarkdownV2", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, CHAT, fetchFn);
      await notifier.taskCompleted(baseTask, successResult);

      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, opts] = fetchFn.mock.calls[0];
      expect(url).toBe(API_URL);
      const body = JSON.parse(opts.body);
      expect(body.chat_id).toBe(CHAT);
      expect(body.parse_mode).toBe("MarkdownV2");
      expect(body.text).toContain("✅");
      expect(body.text).toContain("Task Completed");
      expect(body.text).toContain("Fix login bug");
      expect(body.text).toContain("fix/login");
      expect(body.text).toContain("auth\\-service"); // escaped hyphen
    });

    it("posts failure message with error block", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, CHAT, fetchFn);
      await notifier.taskCompleted({ ...baseTask, status: "failed" }, failResult);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.text).toContain("❌");
      expect(body.text).toContain("Task Failed");
      expect(body.text).toContain("Process exited with code 1");
      expect(body.text).toContain("```"); // error code block
    });

    it("escapes task description containing MarkdownV2 specials", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, CHAT, fetchFn);
      const dangerousTask = { ...baseTask, description: "Fix (v1.0) bug in path_a-b!" };
      await notifier.taskCompleted(dangerousTask, successResult);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.text).toContain("Fix \\(v1\\.0\\) bug in path\\_a\\-b\\!");
    });
  });

  describe("sendMessage", () => {
    it("sends plain text without parse_mode", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, CHAT, fetchFn);
      await notifier.sendMessage("hello world");

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.text).toBe("hello world");
      expect(body.parse_mode).toBeUndefined();
    });
  });

  describe("sendDailyDigest", () => {
    it("sends digest with counts and utilization", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, CHAT, fetchFn);
      const tasks: Task[] = [
        { ...baseTask, id: "t1", status: "completed" },
        { ...baseTask, id: "t2", status: "completed" },
        { ...baseTask, id: "t3", status: "failed" },
      ];
      await notifier.sendDailyDigest(tasks, 44000, 88000);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.parse_mode).toBe("MarkdownV2");
      expect(body.text).toContain("QuotaFlow Daily Digest");
      expect(body.text).toContain("*Completed*: 2");
      expect(body.text).toContain("*Failed*: 1");
      expect(body.text).toContain("50\\.0%");
    });

    it("includes per-project breakdown and outliers when provided", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, CHAT, fetchFn);
      await notifier.sendDailyDigest(
        [],
        0,
        88000,
        [{ project: "MyApp", tokens: 1000, count: 2 }],
        [{ task_id: "t-outlier", size: "medium", actual: 400000, estimated: 60000 }]
      );

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.text).toContain("Per\\-Project");
      expect(body.text).toContain("MyApp");
      expect(body.text).toContain("Estimate Outliers");
      expect(body.text).toContain("t\\-outlier");
    });

    it("shows 0.0% when quotaTotal is 0", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, CHAT, fetchFn);
      await notifier.sendDailyDigest([], 0, 0);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.text).toContain("0\\.0%");
    });
  });

  describe("empty credentials", () => {
    it("skips taskCompleted when token missing", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier("", CHAT, fetchFn);
      await notifier.taskCompleted(baseTask, successResult);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("skips taskCompleted when chat_id missing", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier(TOKEN, "", fetchFn);
      await notifier.taskCompleted(baseTask, successResult);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("skips sendMessage when credentials missing", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier("", "", fetchFn);
      await notifier.sendMessage("ignored");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("skips sendDailyDigest when credentials missing", async () => {
      const fetchFn = makeFetch();
      const notifier = new TelegramNotifier("", "", fetchFn);
      await notifier.sendDailyDigest([baseTask], 5000, 88000);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
