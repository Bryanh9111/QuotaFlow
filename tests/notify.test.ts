import { describe, it, expect, vi, beforeEach } from "vitest";
import { Notifier } from "../src/notify.js";
import type { Task, ExecutionResult } from "../src/types.js";

function makeFetch() {
  return vi.fn().mockResolvedValue({ ok: true });
}

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

describe("Notifier", () => {
  describe("taskCompleted", () => {
    it("sends task completion embed with green color for success", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("https://discord.com/api/webhooks/test", fetchFn);
      await notifier.taskCompleted(baseTask, successResult);

      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, opts] = fetchFn.mock.calls[0];
      expect(url).toBe("https://discord.com/api/webhooks/test");
      const body = JSON.parse(opts.body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0x57f287); // green
      expect(embed.title).toContain("Fix login bug");
      const fieldNames = embed.fields.map((f: { name: string }) => f.name);
      expect(fieldNames).toContain("Branch");
      expect(fieldNames).toContain("Tokens");
      expect(fieldNames).toContain("Duration");
    });

    it("sends failure embed with red color", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("https://discord.com/api/webhooks/test", fetchFn);
      const failedTask: Task = { ...baseTask, status: "failed" };
      await notifier.taskCompleted(failedTask, failResult);

      expect(fetchFn).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0xed4245); // red
      expect(embed.title).toMatch(/failed/i);
      const errorField = embed.fields.find((f: { name: string }) => f.name === "Error");
      expect(errorField).toBeDefined();
      expect(errorField.value).toBe("Process exited with code 1");
    });

    it("does not include error field on success", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("https://discord.com/api/webhooks/test", fetchFn);
      await notifier.taskCompleted(baseTask, successResult);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const errorField = embed.fields.find((f: { name: string }) => f.name === "Error");
      expect(errorField).toBeUndefined();
    });
  });

  describe("sendMessage", () => {
    it("sends plain text message", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("https://discord.com/api/webhooks/test", fetchFn);
      await notifier.sendMessage("hello world");

      expect(fetchFn).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.content).toBe("hello world");
    });
  });

  describe("empty webhookUrl", () => {
    it("skips taskCompleted when no webhook configured", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("", fetchFn);
      await notifier.taskCompleted(baseTask, successResult);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("skips sendMessage when no webhook configured", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("", fetchFn);
      await notifier.sendMessage("ignored");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("skips sendDailyDigest when no webhook configured", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("", fetchFn);
      await notifier.sendDailyDigest([baseTask], 5000, 88000);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe("sendDailyDigest", () => {
    it("sends blue embed with completion and failure counts", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("https://discord.com/api/webhooks/test", fetchFn);

      const tasks: Task[] = [
        { ...baseTask, id: "t1", status: "completed" },
        { ...baseTask, id: "t2", status: "completed" },
        { ...baseTask, id: "t3", status: "failed" },
      ];

      await notifier.sendDailyDigest(tasks, 44000, 88000);

      expect(fetchFn).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0x5865f2); // blue
      expect(embed.title).toBe("QuotaFlow Daily Digest");

      const byName = Object.fromEntries(
        embed.fields.map((f: { name: string; value: string }) => [f.name, f.value])
      );
      expect(byName["Completed"]).toBe("2");
      expect(byName["Failed"]).toBe("1");
      expect(byName["Utilization"]).toBe("50.0%");
    });

    it("shows 0.0% utilization when quotaTotal is 0", async () => {
      const fetchFn = makeFetch();
      const notifier = new Notifier("https://discord.com/api/webhooks/test", fetchFn);
      await notifier.sendDailyDigest([], 0, 0);

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const utilField = embed.fields.find(
        (f: { name: string }) => f.name === "Utilization"
      );
      expect(utilField.value).toBe("0.0%");
    });
  });
});
