import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export class Logger {
  private logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    mkdirSync(logDir, { recursive: true });
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    const ts = new Date().toISOString();
    const date = ts.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.logDir, `${date}.log`);
    const dataPart = data !== undefined ? " " + JSON.stringify(data) : "";
    const line = `[${ts}] ${level}: ${message}${dataPart}\n`;
    appendFileSync(filePath, line, "utf8");
  }

  info(message: string, data?: unknown): void {
    this.write("INFO", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("WARN", message, data);
  }

  error(message: string, data?: unknown): void {
    this.write("ERROR", message, data);
  }

  debug(message: string, data?: unknown): void {
    this.write("DEBUG", message, data);
  }
}
