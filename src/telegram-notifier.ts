import type { Task, ExecutionResult } from "./types.js";

interface TelegramPayload {
  chat_id: string;
  text: string;
  parse_mode?: "MarkdownV2";
  disable_web_page_preview?: boolean;
}

/** Escape MarkdownV2 reserved chars: _ * [ ] ( ) ~ ` > # + - = | { } . ! \ */
export function escapeMd2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private fetchFn: typeof fetch;

  constructor(botToken: string, chatId: string, fetchFn?: typeof fetch) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.fetchFn = fetchFn ?? fetch;
  }

  private async post(payload: TelegramPayload): Promise<void> {
    if (!this.botToken || !this.chatId) return;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async taskCompleted(task: Task, result: ExecutionResult): Promise<void> {
    if (!this.botToken || !this.chatId) return;

    const icon = result.success ? "✅" : "❌";
    const status = result.success ? "Task Completed" : "Task Failed";
    const description = escapeMd2(truncate(task.description, 200));
    const project = escapeMd2(task.project);
    const branch = escapeMd2(result.branch || "N/A");
    const tokens = escapeMd2(result.tokens_used.toLocaleString());
    const durationSec = (result.duration_ms / 1000).toFixed(1);
    const duration = escapeMd2(`${durationSec}s`);

    const lines = [
      `${icon} *${escapeMd2(status)}*`,
      description,
      "",
      `*Project*: \`${project}\``,
      `*Branch*: \`${branch}\``,
      `*Tokens*: ${tokens}`,
      `*Duration*: ${duration}`,
    ];

    if (!result.success && result.error) {
      const err = escapeMd2(truncate(result.error, 500));
      lines.push("", `*Error*:`, "```", err, "```");
    }

    await this.post({
      chat_id: this.chatId,
      text: lines.join("\n"),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    });
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.botToken || !this.chatId) return;
    await this.post({
      chat_id: this.chatId,
      text: content,
    });
  }

  async sendDailyDigest(
    tasks: Task[],
    quotaUsed: number,
    quotaTotal: number,
    projectBreakdown?: Array<{ project: string; tokens: number; count: number }>,
    outliers?: Array<{ task_id: string; size: string; actual: number; estimated: number }>
  ): Promise<void> {
    if (!this.botToken || !this.chatId) return;

    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const utilization = quotaTotal > 0 ? ((quotaUsed / quotaTotal) * 100).toFixed(1) : "0.0";

    const lines = [
      `📊 *QuotaFlow Daily Digest*`,
      "",
      `*Completed*: ${escapeMd2(String(completed))}`,
      `*Failed*: ${escapeMd2(String(failed))}`,
      `*Utilization*: ${escapeMd2(`${utilization}%`)}`,
    ];

    if (projectBreakdown && projectBreakdown.length > 0) {
      const totalTokens = projectBreakdown.reduce((sum, p) => sum + p.tokens, 0);
      lines.push("", `*Per\\-Project Usage*:`);
      for (const p of projectBreakdown.slice(0, 5)) {
        const pct = totalTokens > 0 ? ((p.tokens / totalTokens) * 100).toFixed(0) : "0";
        const proj = escapeMd2(p.project);
        const tokens = escapeMd2(p.tokens.toLocaleString());
        const entry = escapeMd2(`(${pct}%, ${p.count} tasks)`);
        lines.push(`• *${proj}*: ${tokens} ${entry}`);
      }
    }

    if (outliers && outliers.length > 0) {
      lines.push("", `*Estimate Outliers*:`);
      for (const o of outliers.slice(0, 3)) {
        const ratio = (o.actual / o.estimated).toFixed(1);
        const id = escapeMd2(o.task_id);
        const size = escapeMd2(o.size);
        const actual = escapeMd2(o.actual.toLocaleString());
        const detail = escapeMd2(`(${ratio}x estimated ${o.estimated.toLocaleString()})`);
        lines.push(`⚠️ \`${id}\` \\(${size}\\): ${actual} tokens ${detail}`);
      }
    }

    await this.post({
      chat_id: this.chatId,
      text: lines.join("\n"),
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    });
  }
}
