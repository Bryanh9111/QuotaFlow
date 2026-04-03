import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "../src/logger.js";

describe("Logger", () => {
  let logDir: string;
  let logger: Logger;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), "quotaflow-logger-test-"));
    logger = new Logger(logDir);
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  function readLogFile(): string {
    const files = readdirSync(logDir);
    expect(files.length).toBe(1);
    return readFileSync(join(logDir, files[0]), "utf8");
  }

  it("creates a log file named after today (YYYY-MM-DD.log)", () => {
    logger.info("test message");
    const files = readdirSync(logDir);
    expect(files.length).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(files[0]).toBe(`${today}.log`);
  });

  it("writes structured log entries with ISO timestamp and level", () => {
    logger.info("hello world");
    const content = readLogFile();
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).toContain("INFO: hello world");
  });

  it("writes structured log entries with data as JSON", () => {
    logger.info("with data", { key: "value", count: 42 });
    const content = readLogFile();
    expect(content).toContain("INFO: with data");
    expect(content).toContain('{"key":"value","count":42}');
  });

  it("logs warnings", () => {
    logger.warn("something off", { flag: true });
    const content = readLogFile();
    expect(content).toContain("WARN: something off");
    expect(content).toContain('{"flag":true}');
  });

  it("logs errors", () => {
    logger.error("boom", { code: 500 });
    const content = readLogFile();
    expect(content).toContain("ERROR: boom");
    expect(content).toContain('{"code":500}');
  });

  it("logs debug messages", () => {
    logger.debug("trace info", { step: 1 });
    const content = readLogFile();
    expect(content).toContain("DEBUG: trace info");
    expect(content).toContain('{"step":1}');
  });

  it("appends multiple entries to same file", () => {
    logger.info("first");
    logger.warn("second");
    logger.error("third");
    const content = readLogFile();
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("INFO: first");
    expect(lines[1]).toContain("WARN: second");
    expect(lines[2]).toContain("ERROR: third");
  });

  it("writes entry without data part when data is omitted", () => {
    logger.info("no data");
    const content = readLogFile();
    const line = content.trim();
    // Should end right after "no data" with no trailing JSON
    expect(line).toMatch(/INFO: no data$/);
  });

  it("creates log dir if it does not exist", () => {
    const nested = join(logDir, "deep", "nested");
    const l = new Logger(nested);
    l.info("nested");
    const files = readdirSync(nested);
    expect(files.length).toBe(1);
  });
});
