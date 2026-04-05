import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Task, TaskSize, ExecutionResult } from "./types.js";

const execAsync = promisify(exec);

export class TaskExecutor {
  private timeouts: { small: number; medium: number; large: number };

  constructor(timeouts: { small: number; medium: number; large: number }) {
    this.timeouts = timeouts;
  }

  buildBranchName(task: Task): string {
    const prefix = "quotaflow/task-";
    const maxSlugLen = 60 - prefix.length - task.id.length - 1; // -1 for the dash between id and slug
    const slug = task.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxSlugLen);
    return `${prefix}${task.id}-${slug}`;
  }

  buildClaudeCommand(task: Task): string {
    const escapedDesc = task.description.replace(/'/g, "'\\''");
    return `claude -p '${escapedDesc}' --output-format json`;
  }

  getTimeoutMs(size: TaskSize): number {
    return this.timeouts[size] * 60 * 1000;
  }

  async execute(task: Task, projectPath: string): Promise<ExecutionResult> {
    const start = Date.now();

    // P0: check git cleanliness
    let statusOut: string;
    try {
      const { stdout } = await execAsync("git status --porcelain", { cwd: projectPath });
      statusOut = stdout;
    } catch (err) {
      return {
        task_id: task.id,
        success: false,
        branch: "",
        tokens_used: 0,
        duration_ms: Date.now() - start,
        stdout: "",
        stderr: "",
        error: `git status failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (statusOut.trim() !== "") {
      return {
        task_id: task.id,
        success: false,
        branch: "",
        tokens_used: 0,
        duration_ms: Date.now() - start,
        stdout: "",
        stderr: "",
        error: "working directory not clean",
      };
    }

    // Save current branch
    let originalBranch: string;
    try {
      const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: projectPath });
      originalBranch = stdout.trim();
    } catch (err) {
      return {
        task_id: task.id,
        success: false,
        branch: "",
        tokens_used: 0,
        duration_ms: Date.now() - start,
        stdout: "",
        stderr: "",
        error: `could not get current branch: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const branchName = this.buildBranchName(task);

    // Create feature branch
    try {
      await execAsync(`git checkout -B ${branchName}`, { cwd: projectPath });
    } catch (err) {
      return {
        task_id: task.id,
        success: false,
        branch: "",
        tokens_used: 0,
        duration_ms: Date.now() - start,
        stdout: "",
        stderr: "",
        error: `could not create branch: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Run claude CLI
    let claudeStdout = "";
    let claudeStderr = "";
    let tokensUsed = 0;

    try {
      const cmd = this.buildClaudeCommand(task);
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: projectPath,
        timeout: this.getTimeoutMs(task.size),
      });
      claudeStdout = stdout;
      claudeStderr = stderr;

      // Parse token usage from JSON output
      try {
        const parsed = JSON.parse(stdout);
        if (parsed?.usage?.input_tokens !== undefined || parsed?.usage?.output_tokens !== undefined) {
          tokensUsed = (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0);
        } else if (parsed?.tokens_used !== undefined) {
          tokensUsed = parsed.tokens_used;
        } else {
          tokensUsed = Math.floor(stdout.length / 4);
        }
      } catch {
        tokensUsed = Math.floor(stdout.length / 4);
      }
    } catch (err) {
      // Claude failed - clean up branch and return failure
      try {
        await execAsync(`git checkout ${originalBranch}`, { cwd: projectPath });
        await execAsync(`git branch -D ${branchName}`, { cwd: projectPath });
      } catch {
        // best-effort cleanup
      }
      return {
        task_id: task.id,
        success: false,
        branch: "",
        tokens_used: 0,
        duration_ms: Date.now() - start,
        stdout: claudeStdout,
        stderr: claudeStderr,
        error: `claude CLI failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Check for changes
    let hasDiff = false;
    try {
      const { stdout: diffStat } = await execAsync("git diff --stat", { cwd: projectPath });
      hasDiff = diffStat.trim() !== "";
      if (!hasDiff) {
        // Also check staged and untracked
        const { stdout: status2 } = await execAsync("git status --porcelain", { cwd: projectPath });
        hasDiff = status2.trim() !== "";
      }
    } catch {
      // treat as no changes
    }

    if (!hasDiff) {
      // P0: clean up empty branch
      try {
        await execAsync(`git checkout ${originalBranch}`, { cwd: projectPath });
        await execAsync(`git branch -D ${branchName}`, { cwd: projectPath });
      } catch {
        // best-effort cleanup
      }
      return {
        task_id: task.id,
        success: true,
        branch: "",
        tokens_used: tokensUsed,
        duration_ms: Date.now() - start,
        stdout: claudeStdout,
        stderr: claudeStderr,
      };
    }

    // Commit changes using spawn to avoid shell injection (P0)
    try {
      await execAsync("git add -A", { cwd: projectPath });
      await spawnAsync(
        "git",
        ["commit", "-m", `quotaflow: ${task.description}`],
        { cwd: projectPath }
      );
    } catch (err) {
      try {
        await execAsync(`git checkout ${originalBranch}`, { cwd: projectPath });
        await execAsync(`git branch -D ${branchName}`, { cwd: projectPath });
      } catch {
        // best-effort cleanup
      }
      return {
        task_id: task.id,
        success: false,
        branch: "",
        tokens_used: tokensUsed,
        duration_ms: Date.now() - start,
        stdout: claudeStdout,
        stderr: claudeStderr,
        error: `git commit failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Checkout back to original branch
    try {
      await execAsync(`git checkout ${originalBranch}`, { cwd: projectPath });
    } catch {
      // best-effort
    }

    return {
      task_id: task.id,
      success: true,
      branch: branchName,
      tokens_used: tokensUsed,
      duration_ms: Date.now() - start,
      stdout: claudeStdout,
      stderr: claudeStderr,
    };
  }
}

function spawnAsync(
  cmd: string,
  args: string[],
  options: { cwd: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
    proc.on("error", reject);
  });
}
