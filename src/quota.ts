import Database from "better-sqlite3";
import { TaskSize, SIZE_TOKEN_ESTIMATES } from "./types.js";

interface QuotaConfig {
  tokens_per_5h_window: number;
  weekly_compute_hours: number;
  safety_buffer_percent: number;
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class QuotaMonitor {
  private db: Database.Database;
  private config: QuotaConfig;

  constructor(dbPath: string, config: QuotaConfig) {
    this.config = config;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        tokens_used INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS window_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migration: add task_size column if not present
    try {
      this.db.exec("ALTER TABLE usage_log ADD COLUMN task_size TEXT");
    } catch {
      // Column already exists - ignore
    }

    // Initialize window_start if not present
    const exists = this.db
      .prepare("SELECT value FROM window_state WHERE key = 'window_start'")
      .get();
    if (!exists) {
      this.db
        .prepare("INSERT INTO window_state (key, value) VALUES ('window_start', ?)")
        .run(Date.now().toString());
    }
  }

  private getWindowStart(): number {
    const row = this.db
      .prepare("SELECT value FROM window_state WHERE key = 'window_start'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : Date.now();
  }

  private setWindowStartRaw(ts: number): void {
    this.db
      .prepare(
        "INSERT INTO window_state (key, value) VALUES ('window_start', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(ts.toString());
  }

  private clearRateLimit(): void {
    this.db
      .prepare(
        "INSERT INTO window_state (key, value) VALUES ('rate_limited', '0') ON CONFLICT(key) DO UPDATE SET value = '0'"
      )
      .run();
  }

  /** Auto-resets window if 5h has elapsed. Returns current window start. */
  private ensureFreshWindow(): number {
    const now = Date.now();
    const start = this.getWindowStart();
    if (now - start >= FIVE_HOURS_MS) {
      // Use now+1 so the new window start is strictly after any record inserted
      // at "now", preventing stale records from leaking into the fresh window.
      const newStart = now + 1;
      this.setWindowStartRaw(newStart);
      this.clearRateLimit();
      return newStart;
    }
    return start;
  }

  private getTokensUsedInWindow(windowStart: number): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(tokens_used), 0) AS total FROM usage_log WHERE recorded_at >= ?"
      )
      .get(windowStart) as { total: number };
    return row.total;
  }

  recordUsage(taskId: string, tokensUsed: number, durationMs: number, size?: TaskSize): void {
    this.db
      .prepare(
        "INSERT INTO usage_log (task_id, tokens_used, duration_ms, recorded_at, task_size) VALUES (?, ?, ?, ?, ?)"
      )
      .run(taskId, tokensUsed, durationMs, Date.now(), size ?? null);
  }

  estimateTokens(size: TaskSize): number {
    const row = this.db
      .prepare(
        "SELECT AVG(tokens_used) AS avg_tokens, COUNT(*) AS cnt FROM usage_log WHERE task_size = ? AND tokens_used > 0"
      )
      .get(size) as { avg_tokens: number | null; cnt: number };

    if (row.cnt >= 3 && row.avg_tokens !== null) {
      return Math.round(row.avg_tokens);
    }
    return SIZE_TOKEN_ESTIMATES[size];
  }

  getAvailableTokens(): number {
    const windowStart = this.ensureFreshWindow();
    const usable = Math.floor(
      this.config.tokens_per_5h_window *
        (1 - this.config.safety_buffer_percent / 100)
    );
    const used = this.getTokensUsedInWindow(windowStart);
    return Math.max(0, usable - used);
  }

  hasQuotaFor(size: TaskSize): boolean {
    return this.getAvailableTokens() >= SIZE_TOKEN_ESTIMATES[size];
  }

  markRateLimited(): void {
    this.db
      .prepare(
        "INSERT INTO window_state (key, value) VALUES ('rate_limited', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
      )
      .run();
  }

  isWindowExhausted(): boolean {
    // Calling ensureFreshWindow resets rate_limited flag if window rolled
    this.ensureFreshWindow();
    const row = this.db
      .prepare("SELECT value FROM window_state WHERE key = 'rate_limited'")
      .get() as { value: string } | undefined;
    return row?.value === "1";
  }

  getWeeklyUsage(): { total_tokens: number; total_duration_ms: number; task_count: number } {
    const since = Date.now() - SEVEN_DAYS_MS;
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(tokens_used), 0) AS total_tokens,
          COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
          COUNT(*) AS task_count
        FROM usage_log WHERE recorded_at >= ?`
      )
      .get(since) as { total_tokens: number; total_duration_ms: number; task_count: number };
    return row;
  }

  /** For testing: set window start to a specific date and clear rate limit. */
  setWindowStart(date: Date): void {
    this.setWindowStartRaw(date.getTime());
    this.clearRateLimit();
  }

  close(): void {
    this.db.close();
  }
}
