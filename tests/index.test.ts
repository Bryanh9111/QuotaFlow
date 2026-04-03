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
