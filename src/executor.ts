import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Task, TaskSize, ExecutionResult, RateLimitInfo } from "./types.js";

const execAsync = promisify(exec);

interface StreamEvent {
  type: string;
  subtype?: string;
  result?: string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  rate_limit_info?: {
    status: string;
    resetsAt: number;
    rateLimitType: string;
    overageStatus?: string;
    overageResetsAt?: number;
    isUsingOverage?: boolean;
  };
}

function parseStreamOutput(stdout: string): {
  tokensUsed: number;
  rateLimit: RateLimitInfo | undefined;
  resultText: string;
} {
  let tokensUsed = 0;
  let rateLimit: RateLimitInfo | undefined;
  let resultText = "";

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event: StreamEvent = JSON.parse(line);

      if (event.type === "rate_limit_event" && event.rate_limit_info) {
        rateLimit = {
          status: event.rate_limit_info.status,
          rateLimitType: event.rate_limit_info.rateLimitType,
          resetsAt: event.rate_limit_info.resetsAt,
          isUsingOverage: event.rate_limit_info.isUsingOverage ?? false,
        };
      }

      if (event.type === "result" && event.usage) {
        tokensUsed =
          (event.usage.input_tokens ?? 0) +
          (event.usage.cache_creation_input_tokens ?? 0) +
          (event.usage.cache_read_input_tokens ?? 0) +
          (event.usage.output_tokens ?? 0);
        resultText = event.result ?? "";
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return { tokensUsed, rateLimit, resultText };
}

export class TaskExecutor {
  private timeouts: { small: number; medium: number; large: number };

  constructor(timeouts: { small: number; medium: number; large: number }) {
    this.timeouts = timeouts;
  }

  buildBranchName(task: Task): string {
    const prefix = "quotaflow/task-";
    const maxSlugLen = 60 - prefix.length - task.id.length - 1;
    const slug = task.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxSlugLen);
    return `${prefix}${task.id}-${slug}`;
  }

  buildClaudeArgs(task: Task): string[] {
    return ["-p", task.description, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
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

    // Run claude CLI with stream-json output
    let claudeStdout = "";
    let claudeStderr = "";
    let tokensUsed = 0;
    let rateLimit: RateLimitInfo | undefined;

    try {
      const args = this.buildClaudeArgs(task);
      const { stdout, stderr } = await spawnAsync("claude", args, {
        cwd: projectPath,
        timeout: this.getTimeoutMs(task.size),
      });
      claudeStdout = stdout;
      claudeStderr = stderr;

      // Parse stream-json output for real usage and rate limit data
      const parsed = parseStreamOutput(stdout);
      tokensUsed = parsed.tokensUsed;
      rateLimit = parsed.rateLimit;
    } catch (err) {
      // Claude failed - clean up branch and return failure
      try {
        await execAsync(`git checkout ${originalBranch}`, { cwd: projectPath });
        await execAsync(`git branch -D ${branchName}`, { cwd: projectPath });
      } catch {
        // best-effort cleanup
      }

      // Try to parse partial output for rate limit info
      if (claudeStdout) {
        const parsed = parseStreamOutput(claudeStdout);
        rateLimit = parsed.rateLimit;
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
        rate_limit: rateLimit,
      };
    }

    // Check for changes
    let hasDiff = false;
    try {
      const { stdout: diffStat } = await execAsync("git diff --stat", { cwd: projectPath });
      hasDiff = diffStat.trim() !== "";
      if (!hasDiff) {
        const { stdout: status2 } = await execAsync("git status --porcelain", { cwd: projectPath });
        hasDiff = status2.trim() !== "";
      }
    } catch {
      // treat as no changes
    }

    if (!hasDiff) {
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
        rate_limit: rateLimit,
      };
    }

    // Commit changes using spawn to avoid shell injection
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
        rate_limit: rateLimit,
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
      rate_limit: rateLimit,
    };
  }
}

function spawnAsync(
  cmd: string,
  args: string[],
  options: { cwd: string; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;

    if (options.timeout) {
      setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
      }, options.timeout);
    }

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (killed) reject(new Error(`${cmd} timed out after ${options.timeout}ms`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on("error", reject);
  });
}
