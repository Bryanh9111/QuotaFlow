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

  it("reports active when claude CLI session is running", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1234, command: "/Users/testuser/.local/bin/claude --resume abc123" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(true);
  });

  it("excludes own PIDs registered via registerOwnPid", async () => {
    detector.registerOwnPid(1234);
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 1234, command: "/Users/testuser/.local/bin/claude --resume abc" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("excludes daemon's own spawned claude -p processes", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 5678, command: "/Users/testuser/.local/bin/claude -p task --output-format stream-json --dangerously-skip-permissions" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("excludes Claude Desktop app processes", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 2000, command: "/Users/testuser/Library/Application Support/Claude/claude-code/2.1.87/claude.app/Contents/MacOS/claude --output-format stream-json" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("excludes plugin and MCP processes", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 3000, command: "bun run --cwd /path/to/plugin start" },
      { pid: 3001, command: "node /path/to/mcp-server.cjs" },
    ]);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });

  it("detects user's interactive CLI with channels/plugins as active", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([
      { pid: 4000, command: "/Users/testuser/.local/bin/claude --channels plugin:discord --dangerously-skip-permissions" },
    ]);
    const active = await detector.isUserActive();
    // This has --dangerously-skip-permissions but NOT stream-json, so it's user session
    expect(active).toBe(true);
  });

  it("reports active when last active was within threshold", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([]);
    const recentTime = new Date(Date.now() - 5 * 60 * 1000);
    detector.setLastActiveTime(recentTime);
    const active = await detector.isUserActive();
    expect(active).toBe(true);
  });

  it("reports inactive when last active time is past threshold", async () => {
    vi.spyOn(detector, "getClaudeProcesses").mockResolvedValue([]);
    const oldTime = new Date(Date.now() - 20 * 60 * 1000);
    detector.setLastActiveTime(oldTime);
    const active = await detector.isUserActive();
    expect(active).toBe(false);
  });
});
