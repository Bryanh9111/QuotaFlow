import type { Task, ExecutionResult } from "./types.js";

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  color: number;
  fields: DiscordField[];
  timestamp: string;
}

interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

const COLOR_GREEN = 0x57f287;
const COLOR_RED = 0xed4245;
const COLOR_BLUE = 0x5865f2;

export class Notifier {
  private webhookUrl: string;
  private fetchFn: typeof fetch;

  constructor(webhookUrl: string, fetchFn?: typeof fetch) {
    this.webhookUrl = webhookUrl;
    this.fetchFn = fetchFn ?? fetch;
  }

  private async post(payload: DiscordPayload): Promise<void> {
    if (!this.webhookUrl) return;
    await this.fetchFn(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async taskCompleted(task: Task, result: ExecutionResult): Promise<void> {
    if (!this.webhookUrl) return;

    const success = result.success;
    const color = success ? COLOR_GREEN : COLOR_RED;
    const title = success
      ? `Task Completed: ${task.description}`
      : `Task Failed: ${task.description}`;

    const fields: DiscordField[] = [
      { name: "Branch", value: result.branch || "N/A", inline: true },
      { name: "Tokens", value: String(result.tokens_used), inline: true },
      {
        name: "Duration",
        value: `${(result.duration_ms / 1000).toFixed(1)}s`,
        inline: true,
      },
    ];

    if (!success && result.error) {
      fields.push({ name: "Error", value: result.error });
    }

    await this.post({
      embeds: [{ title, color, fields, timestamp: new Date().toISOString() }],
    });
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.webhookUrl) return;
    await this.post({ content });
  }

  async sendDailyDigest(
    tasks: Task[],
    quotaUsed: number,
    quotaTotal: number
  ): Promise<void> {
    if (!this.webhookUrl) return;

    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const utilization =
      quotaTotal > 0 ? ((quotaUsed / quotaTotal) * 100).toFixed(1) : "0.0";

    const fields: DiscordField[] = [
      { name: "Completed", value: String(completed), inline: true },
      { name: "Failed", value: String(failed), inline: true },
      { name: "Quota Utilization", value: `${utilization}%`, inline: true },
    ];

    await this.post({
      embeds: [
        {
          title: "Daily Digest",
          color: COLOR_BLUE,
          fields,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }
}
