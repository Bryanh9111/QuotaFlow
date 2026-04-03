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

  async isUserActive(): Promise<boolean> {
    const processes = await this.getClaudeProcesses();
    const external = processes.filter((p) => !this.ownPids.has(p.pid));

    if (external.length > 0) {
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
