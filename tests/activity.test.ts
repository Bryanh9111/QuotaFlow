import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityDetector } from "../src/activity.js";

describe("ActivityDetector", () => {
  let detector: ActivityDetector;

  beforeEach(() => {
    detector = new ActivityDetector(15);
  });

  it("reports inactive when no processes found", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([]);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("reports active when claude processes are running", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1234, command: "node claude" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(true);
  });

  it("excludes own PIDs registered via registerOwnPid", async () => {
    detector.registerOwnPid(1234);
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1234, command: "node claude" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("excludes multiple own PIDs and reports inactive when all excluded", async () => {
    detector.registerOwnPid(1234);
    detector.registerOwnPid(5678);
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1234, command: "node claude" },
      { pid: 5678, command: "node claude worker" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("reports active when last active was within threshold", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([]);
    // 5 minutes ago, threshold is 15 — still active
    const recentTime = new Date(Date.now() - 5 * 60 * 1000);
    detector.setLastActiveTime(recentTime);
    const active = await detector.isUserActive();
    expect(active).toBe(true);
  });

  it("reports inactive when last active time is past threshold", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([]);
    // 20 minutes ago, threshold is 15 — inactive
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    detector.setLastActiveTime(oldTime);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("reports active when non-own process exists even if lastActiveTime is stale", async () => {
    detector.registerOwnPid(9999);
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1111, command: "claude session" },
    ]);
    const oldTime = new Date(Date.now() - 60 * 60 * 1000);
    detector.setLastActiveTime(oldTime);
    const active = await detector.isUserActive();
    expect(active).toBe(true);
  });
});
