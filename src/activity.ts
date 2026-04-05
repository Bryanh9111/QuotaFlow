import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ClaudeProcess {
  pid: number;
  command: string;
}

export class ActivityDetector {
  private thresholdMinutes: number;
  private ownPids: Set<number> = new Set();
  private lastActiveTime: Date | null = null;

  constructor(thresholdMinutes: number) {
    this.thresholdMinutes = thresholdMinutes;
  }

  registerOwnPid(pid: number): void {
    this.ownPids.add(pid);
  }

  setLastActiveTime(time: Date): void {
    this.lastActiveTime = time;
  }

  async getClaudeProcesses(): Promise<ClaudeProcess[]> {
    try {
      const { stdout } = await execAsync("pgrep -fl claude");
      const lines = stdout.trim().split("\n").filter(Boolean);
      const processes: ClaudeProcess[] = [];
      for (const line of lines) {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (match) {
          processes.push({ pid: parseInt(match[1], 10), command: match[2] });
        }
      }
      return processes;
    } catch {
      // pgrep exits with code 1 when no processes found
      return [];
    }
  }

  private isOwnProcess(command: string): boolean {
    // Exclude QuotaFlow's own spawned claude -p processes
    // They always have --dangerously-skip-permissions + stream-json combo
    return command.includes("quotaflow") ||
      (command.includes("--dangerously-skip-permissions") && command.includes("stream-json"));
  }

  private isClaudeCliSession(command: string): boolean {
    // Exclude non-CLI processes that happen to contain "claude" in path
    const nonCliPatterns = [
      "claude.app/",          // Desktop app bundle (any path containing claude.app/)
      "Claude.app",           // Desktop app (capitalized)
      "disclaimer",           // Desktop app wrapper
      "mcp-server",           // MCP server processes
      "worker-service",       // Background workers
      "chroma-mcp",           // ChromaDB MCP
      "bun run",              // Plugin runners
      "uvx",                  // Python tool runners
      "/plugins/",             // Plugin subprocess paths
    ];
    if (nonCliPatterns.some((p) => command.includes(p))) return false;

    // Must be an actual claude CLI binary (not a subprocess of desktop app)
    return command.includes("/claude") || command.startsWith("claude ");
  }

  async isUserActive(): Promise<boolean> {
    const processes = await this.getClaudeProcesses();
    const external = processes.filter(
      (p) => !this.ownPids.has(p.pid) && !this.isOwnProcess(p.command) && this.isClaudeCliSession(p.command)
    );

    if (external.length > 0) {
      this.lastActiveTime = new Date();
      return true;
    }

    if (this.lastActiveTime !== null) {
      const elapsedMs = Date.now() - this.lastActiveTime.getTime();
      const elapsedMinutes = elapsedMs / 60000;
      if (elapsedMinutes < this.thresholdMinutes) {
        return true;
      }
    }

    return false;
  }
}
