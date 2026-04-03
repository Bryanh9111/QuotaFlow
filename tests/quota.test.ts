import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { QuotaMonitor } from "../src/quota.js";
import { SIZE_TOKEN_ESTIMATES } from "../src/types.js";

const BASE_CONFIG = {
  tokens_per_5h_window: 88000,
  weekly_compute_hours: 200,
  safety_buffer_percent: 10,
};

// Usable = 88000 * 0.9 = 79200
const USABLE_TOKENS = Math.floor(88000 * 0.9);

let dbPath: string;
let monitor: QuotaMonitor;

beforeEach(() => {
  dbPath = join(tmpdir(), `quota-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  monitor = new QuotaMonitor(dbPath, BASE_CONFIG);
});

afterEach(() => {
  monitor.close();
  rmSync(dbPath, { force: true });
  // WAL mode creates -shm and -wal side files
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
});

describe("QuotaMonitor", () => {
  it("starts with full usable quota (88000 * 0.9)", () => {
    expect(monitor.getAvailableTokens()).toBe(USABLE_TOKENS);
  });

  it("reduces available tokens after recording usage", () => {
    monitor.recordUsage("task-1", 10000, 5000);
    expect(monitor.getAvailableTokens()).toBe(USABLE_TOKENS - 10000);
  });

  it("resets window after 5 hours via setWindowStart", () => {
    monitor.recordUsage("task-1", 50000, 10000);
    expect(monitor.getAvailableTokens()).toBe(USABLE_TOKENS - 50000);

    // Backdate window start 6 hours; next getAvailableTokens triggers reset.
    // ensureFreshWindow sets new window_start = Date.now()+1, which is strictly
    // after the usage record, so the fresh window starts at zero usage.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    monitor.setWindowStart(sixHoursAgo);

    expect(monitor.getAvailableTokens()).toBe(USABLE_TOKENS);
  });

  it("marks window exhausted on rate limit and clears on window reset", () => {
    expect(monitor.isWindowExhausted()).toBe(false);

    monitor.markRateLimited();
    expect(monitor.isWindowExhausted()).toBe(true);

    // Advance past window boundary
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    monitor.setWindowStart(sixHoursAgo);

    expect(monitor.isWindowExhausted()).toBe(false);
  });

  it("tracks weekly usage across multiple recordings", () => {
    monitor.recordUsage("task-1", 10000, 3000);
    monitor.recordUsage("task-2", 20000, 7000);
    monitor.recordUsage("task-3", 5000, 1000);

    const weekly = monitor.getWeeklyUsage();
    expect(weekly.total_tokens).toBe(35000);
    expect(weekly.total_duration_ms).toBe(11000);
    expect(weekly.task_count).toBe(3);
  });

  it("hasQuotaFor returns true when enough tokens available", () => {
    expect(monitor.hasQuotaFor("small")).toBe(true);   // needs 10000, has 79200
    expect(monitor.hasQuotaFor("medium")).toBe(true);  // needs 30000
    expect(monitor.hasQuotaFor("large")).toBe(true);   // needs 60000
  });

  it("hasQuotaFor returns false after quota is nearly exhausted", () => {
    // Use up enough so large can't fit but small can
    const toUse = USABLE_TOKENS - SIZE_TOKEN_ESTIMATES["medium"] + 1; // leaves < medium
    monitor.recordUsage("task-1", toUse, 1000);

    expect(monitor.hasQuotaFor("large")).toBe(false);
    expect(monitor.hasQuotaFor("medium")).toBe(false);
    // small: needs 10000; available = USABLE_TOKENS - toUse = medium_estimate - 1 = 29999
    expect(monitor.hasQuotaFor("small")).toBe(true);
  });

  it("hasQuotaFor checks against SIZE_TOKEN_ESTIMATES values", () => {
    // Exhaust all tokens
    monitor.recordUsage("task-1", USABLE_TOKENS, 1000);
    expect(monitor.hasQuotaFor("small")).toBe(false);
    expect(monitor.hasQuotaFor("medium")).toBe(false);
    expect(monitor.hasQuotaFor("large")).toBe(false);
  });

  it("persists data across close and reopen", () => {
    monitor.recordUsage("task-persist", 15000, 2000);
    monitor.close();

    const monitor2 = new QuotaMonitor(dbPath, BASE_CONFIG);
    try {
      expect(monitor2.getAvailableTokens()).toBe(USABLE_TOKENS - 15000);
      const weekly = monitor2.getWeeklyUsage();
      expect(weekly.total_tokens).toBe(15000);
      expect(weekly.task_count).toBe(1);
    } finally {
      monitor2.close();
    }

    // Re-assign so afterEach doesn't double-close
    monitor = { close: () => {} } as unknown as QuotaMonitor;
  });

  it("getAvailableTokens never goes below zero", () => {
    monitor.recordUsage("task-1", USABLE_TOKENS + 5000, 1000);
    expect(monitor.getAvailableTokens()).toBe(0);
  });

  it("getWeeklyUsage returns zeros when no records", () => {
    const weekly = monitor.getWeeklyUsage();
    expect(weekly.total_tokens).toBe(0);
    expect(weekly.total_duration_ms).toBe(0);
    expect(weekly.task_count).toBe(0);
  });

  describe("estimateTokens", () => {
    it("returns SIZE_TOKEN_ESTIMATES default when no history", () => {
      expect(monitor.estimateTokens("small")).toBe(10000);
      expect(monitor.estimateTokens("medium")).toBe(30000);
      expect(monitor.estimateTokens("large")).toBe(60000);
    });

    it("returns SIZE_TOKEN_ESTIMATES default when fewer than 3 samples", () => {
      monitor.recordUsage("t1", 8000, 1000, "small");
      monitor.recordUsage("t2", 12000, 1000, "small");
      // Only 2 samples - should still fall back to default
      expect(monitor.estimateTokens("small")).toBe(10000);
    });

    it("returns average when 3 or more samples exist", () => {
      monitor.recordUsage("t1", 8000, 1000, "small");
      monitor.recordUsage("t2", 12000, 1000, "small");
      monitor.recordUsage("t3", 10000, 1000, "small");
      monitor.recordUsage("t4", 14000, 1000, "small");
      monitor.recordUsage("t5", 6000, 1000, "small");
      // avg = (8000+12000+10000+14000+6000) / 5 = 50000 / 5 = 10000
      expect(monitor.estimateTokens("small")).toBe(10000);
    });

    it("only averages matching size, not other sizes", () => {
      // Record 3 medium tasks with distinct average
      monitor.recordUsage("m1", 20000, 1000, "medium");
      monitor.recordUsage("m2", 25000, 1000, "medium");
      monitor.recordUsage("m3", 30000, 1000, "medium");
      // avg medium = 25000; small has no history so uses default
      expect(monitor.estimateTokens("medium")).toBe(25000);
      expect(monitor.estimateTokens("small")).toBe(10000);
    });
  });
});
