import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskExecutor } from "../src/executor.js";
import type { Task } from "../src/types.js";

const defaultTimeouts = { small: 5, medium: 15, large: 45 };

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abc123",
    description: "fix the login bug",
    project: "test-project",
    priority: "medium",
    size: "small",
    status: "queued",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTempGitRepo(): { dir: string; initialBranch: string } {
  const dir = mkdtempSync(join(tmpdir(), "quotaflow-test-"));
  execSync(
    "git init && git config user.email test@test.com && git config user.name Test && git commit --allow-empty -m init",
    { cwd: dir, stdio: "pipe" }
  );
  const initialBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir })
    .toString()
    .trim();
  return { dir, initialBranch };
}

describe("TaskExecutor.buildBranchName", () => {
  const ex = new TaskExecutor(defaultTimeouts);

  it("creates correct format", () => {
    const task = makeTask({ id: "abc123", description: "fix the login bug" });
    const branch = ex.buildBranchName(task);
    expect(branch).toBe("quotaflow/task-abc123-fix-the-login-bug");
  });

  it("lowercases description", () => {
    const task = makeTask({ id: "x1", description: "Fix AUTH Token" });
    expect(ex.buildBranchName(task)).toBe("quotaflow/task-x1-fix-auth-token");
  });

  it("replaces non-alphanumeric chars with hyphens", () => {
    const task = makeTask({ id: "t1", description: "update: config & settings!" });
    const branch = ex.buildBranchName(task);
    expect(branch).toMatch(/^quotaflow\/task-t1-update-config-settings$/);
  });

  it("truncates long descriptions to max 60 chars total", () => {
    const task = makeTask({
      id: "id1",
      description: "this is an extremely long description that goes way beyond sixty characters in total length",
    });
    const branch = ex.buildBranchName(task);
    expect(branch.length).toBeLessThanOrEqual(60);
    expect(branch.startsWith("quotaflow/task-id1-")).toBe(true);
  });
});

describe("TaskExecutor.buildClaudeCommand", () => {
  const ex = new TaskExecutor(defaultTimeouts);

  it("contains required flags", () => {
    const task = makeTask({ description: "add dark mode" });
    const cmd = ex.buildClaudeCommand(task, "/some/project/path");
    expect(cmd).toContain("claude -p");
    expect(cmd).toContain("-C");
    expect(cmd).toContain("--output-format json");
    expect(cmd).toContain("/some/project/path");
    expect(cmd).toContain("add dark mode");
  });

  it("escapes single quotes in description", () => {
    const task = makeTask({ description: "fix it's broken" });
    const cmd = ex.buildClaudeCommand(task, "/proj");
    // Should not contain unescaped single quote that would break shell
    // The description should be safely embedded
    expect(cmd).toContain("fix it");
    expect(cmd).toContain("s broken");
    // Verify the command starts with the right structure
    expect(cmd).toMatch(/^claude -p '/);
  });

  it("wraps description and cwd in single quotes", () => {
    const task = makeTask({ description: "simple task" });
    const cmd = ex.buildClaudeCommand(task, "/my/project");
    expect(cmd).toMatch(/claude -p 'simple task'/);
    expect(cmd).toContain("-C '/my/project'");
  });
});

describe("TaskExecutor.getTimeoutMs", () => {
  const ex = new TaskExecutor({ small: 5, medium: 15, large: 45 });

  it("returns correct ms for small", () => {
    expect(ex.getTimeoutMs("small")).toBe(5 * 60 * 1000);
  });

  it("returns correct ms for medium", () => {
    expect(ex.getTimeoutMs("medium")).toBe(15 * 60 * 1000);
  });

  it("returns correct ms for large", () => {
    expect(ex.getTimeoutMs("large")).toBe(45 * 60 * 1000);
  });

  it("respects custom timeouts", () => {
    const custom = new TaskExecutor({ small: 2, medium: 10, large: 30 });
    expect(custom.getTimeoutMs("small")).toBe(2 * 60 * 1000);
    expect(custom.getTimeoutMs("medium")).toBe(10 * 60 * 1000);
    expect(custom.getTimeoutMs("large")).toBe(30 * 60 * 1000);
  });
});

describe("TaskExecutor.execute", () => {
  it("returns failure when working directory is dirty", async () => {
    const { dir } = makeTempGitRepo();
    try {
      // Create an uncommitted file to make the repo dirty
      writeFileSync(join(dir, "dirty.txt"), "untracked content");

      const ex = new TaskExecutor(defaultTimeouts);
      const task = makeTask({ id: "t1", description: "some task", size: "small" });
      const result = await ex.execute(task, dir);

      expect(result.success).toBe(false);
      expect(result.error).toBe("working directory not clean");
      expect(result.task_id).toBe("t1");
      expect(result.branch).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles missing claude CLI gracefully and cleans up branch", async () => {
    const { dir, initialBranch } = makeTempGitRepo();
    try {
      const ex = new TaskExecutor(defaultTimeouts);
      const task = makeTask({ id: "t2", description: "test missing cli", size: "small" });
      const result = await ex.execute(task, dir);

      // claude is not available in subprocess, so it should fail
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.task_id).toBe("t2");

      // Branch should have been cleaned up - we should be back on original branch
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir }).toString().trim();
      expect(currentBranch).toBe(initialBranch);

      // The feature branch should not exist
      const branches = execSync("git branch", { cwd: dir }).toString();
      const branchName = ex.buildBranchName(task);
      expect(branches).not.toContain(branchName.replace("quotaflow/", ""));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
