import type { Config, Task, TaskSize, TaskPriority } from "./types.js";
import type { TelegramState } from "./telegram-state.js";
import { parseCommand } from "./telegram-command-parser.js";
import { getProjectsRoots } from "./config.js";
import { resolveProject, listAllProjects } from "./project-resolver.js";

interface PollerDeps {
  config: Config;
  state: TelegramState;
  queue: {
    addTask(input: { description: string; project: string; priority: TaskPriority; size: TaskSize }): Task;
    getQueued(): Task[];
    updateTask(id: string, updates: Partial<Task>): Task;
  };
  quota: {
    getAvailableTokens(): number;
  };
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    debug(msg: string, data?: Record<string, unknown>): void;
  };
  fetchFn?: typeof fetch;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

const LONG_POLL_TIMEOUT_SEC = 30;
const POLL_INTERVAL_MS = 1_000; // only after a successful poll; getUpdates itself blocks up to 30s

export class TelegramPoller {
  private deps: PollerDeps;
  private fetchFn: typeof fetch;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private inFlight = false;

  constructor(deps: PollerDeps) {
    this.deps = deps;
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  start(): void {
    const { config, logger } = this.deps;
    if (!config.telegram_bot_token || !config.telegram_chat_id) {
      logger.debug("telegram poller not started: credentials missing");
      return;
    }
    if (!config.telegram_command_secret) {
      logger.warn("telegram poller not started: telegram_command_secret is empty (required for inbound commands)");
      return;
    }
    logger.info("telegram poller started", { chat_id: config.telegram_chat_id });
    this.stopping = false;
    this.scheduleNextTick(0);
  }

  stop(): void {
    this.stopping = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  /** Public for tests */
  async tick(): Promise<void> {
    if (this.inFlight || this.stopping) return;
    this.inFlight = true;
    try {
      await this.pollOnce();
    } catch (err) {
      // Absolute isolation: never let poller errors leak to scheduler
      this.deps.logger.error("telegram poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.inFlight = false;
      this.scheduleNextTick(POLL_INTERVAL_MS);
    }
  }

  private async pollOnce(): Promise<void> {
    const { config, state, logger } = this.deps;
    const offset = state.getLastUpdateId() + 1;

    const url = `https://api.telegram.org/bot${config.telegram_bot_token}/getUpdates?offset=${offset}&timeout=${LONG_POLL_TIMEOUT_SEC}`;
    const resp = await this.fetchFn(url, { method: "GET" });
    if (!resp.ok) {
      logger.warn("getUpdates http error", { status: resp.status });
      return;
    }
    const body = (await resp.json()) as TelegramResponse<TelegramUpdate[]>;
    if (!body.ok) {
      logger.warn("getUpdates api error", { desc: body.description });
      return;
    }

    for (const update of body.result) {
      state.setLastUpdateId(update.update_id);
      await this.handleUpdate(update);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const { config, state, logger } = this.deps;
    const msg = update.message;
    if (!msg || !msg.text) return;

    // Layer 1: chat_id whitelist (silent drop on mismatch)
    if (String(msg.chat.id) !== String(config.telegram_chat_id)) {
      logger.warn("telegram message rejected: chat_id mismatch", {
        got: msg.chat.id,
        expected: config.telegram_chat_id,
      });
      return;
    }

    // Layer 2: dedup (replay / retry protection)
    if (state.isProcessed(msg.message_id)) {
      logger.debug("telegram message already processed", { message_id: msg.message_id });
      return;
    }

    // Layer 3: passphrase (first token must match; sensitive -- silent drop)
    const tokens = msg.text.trim().split(/\s+/);
    if (tokens.length === 0 || tokens[0] !== config.telegram_command_secret) {
      logger.warn("telegram message rejected: passphrase mismatch");
      state.markProcessed(msg.message_id);
      return;
    }

    // Authorized. Mark processed BEFORE acting to guarantee idempotency even on crash.
    state.markProcessed(msg.message_id);
    const bodyText = tokens.slice(1).join(" ");
    await this.dispatchCommand(bodyText);
  }

  private async dispatchCommand(text: string): Promise<void> {
    const parsed = parseCommand(text);
    switch (parsed.kind) {
      case "empty":
        await this.reply("Empty command. Send `/help` for usage.");
        return;
      case "help":
        await this.reply(this.helpText());
        return;
      case "list":
        await this.reply(this.listText(parsed.limit ?? 10));
        return;
      case "status":
        await this.reply(this.statusText());
        return;
      case "rm": {
        try {
          this.deps.queue.updateTask(parsed.id, { status: "skipped" });
          await this.reply(`Task \`${parsed.id}\` removed.`);
        } catch (err) {
          await this.reply(`Not found: \`${parsed.id}\``);
        }
        return;
      }
      case "add": {
        const { config } = this.deps;
        const size = parsed.size ?? config.default_size;
        const priority = parsed.priority ?? config.default_priority;
        const projectRaw = parsed.project;
        if (!projectRaw) {
          await this.reply(
            "No project specified. Use `@ProjectName <desc>` or `/add proj=ProjectName <desc>`. " +
            "Send `/list-projects` to see available projects."
          );
          return;
        }
        const roots = getProjectsRoots(config);
        const outcome = resolveProject(projectRaw, roots);
        if (!outcome.hit) {
          const candidates = outcome.candidates.length > 0
            ? `\nCandidates: ${outcome.candidates.slice(0, 8).map((c) => `\`${c.name}\``).join(", ")}`
            : "";
          await this.reply(
            `Project not found: \`${projectRaw}\`.${candidates}`
          );
          return;
        }
        try {
          const task = this.deps.queue.addTask({
            description: parsed.description,
            project: outcome.hit.name,
            priority,
            size,
          });
          const ambiguityNote = outcome.matchKind !== "exact" && outcome.matchKind !== "absolute"
            ? ` (matched via ${outcome.matchKind})`
            : "";
          await this.reply(
            `Queued \`${task.id}\`\n` +
            `project: \`${outcome.hit.name}\`${ambiguityNote} | size: ${size} | priority: ${priority}`
          );
          this.deps.logger.info("telegram task added", { id: task.id, project: outcome.hit.name });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await this.reply(`Failed to queue: ${msg}`);
        }
        return;
      }
      case "unknown":
        if (parsed.raw === "/list-projects" || parsed.raw.startsWith("/list-projects")) {
          await this.reply(this.listProjectsText());
          return;
        }
        await this.reply(`Unknown command. Send \`/help\` for usage.`);
        return;
    }
  }

  private listProjectsText(): string {
    const roots = getProjectsRoots(this.deps.config);
    const all = listAllProjects(roots);
    if (all.length === 0) return "No projects found in configured roots.";
    // Group by root for clarity
    const byRoot = new Map<string, string[]>();
    for (const p of all) {
      if (!byRoot.has(p.root)) byRoot.set(p.root, []);
      byRoot.get(p.root)!.push(p.name);
    }
    const lines: string[] = ["*Available projects:*"];
    for (const [root, names] of byRoot.entries()) {
      lines.push(`\n_${root}_:`);
      lines.push(names.sort().map((n) => `• \`${n}\``).join("\n"));
    }
    return lines.join("\n");
  }

  private helpText(): string {
    return [
      "*QuotaFlow Telegram Commands*",
      "",
      "Prefix every message with your `telegram_command_secret`.",
      "",
      "`<secret> @Project Fix login bug`",
      "  → queue with project auto-resolved via fuzzy match",
      "`<secret> /add proj=Project size=large pri=high <desc>`",
      "  → full control over size/priority",
      "`<secret> /list [N]` - show queued tasks",
      "`<secret> /list-projects` - show all projects in configured roots",
      "`<secret> /status` - quota + queue summary",
      "`<secret> /rm <id>` - remove task",
      "`<secret> /help`",
    ].join("\n");
  }

  private listText(limit: number): string {
    const queued = this.deps.queue.getQueued().slice(0, limit);
    if (queued.length === 0) return "Queue is empty.";
    const lines = queued.map(
      (t) => `\`${t.id}\` [${t.size}/${t.priority}] ${t.project}: ${t.description.slice(0, 60)}`
    );
    return `*Queued (${queued.length})*:\n${lines.join("\n")}`;
  }

  private statusText(): string {
    const available = this.deps.quota.getAvailableTokens();
    const queued = this.deps.queue.getQueued().length;
    return `*QuotaFlow Status*\nAvailable tokens: ${available.toLocaleString()}\nQueued: ${queued}`;
  }

  private async reply(text: string): Promise<void> {
    const { config, logger } = this.deps;
    const url = `https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`;
    try {
      await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegram_chat_id,
          text,
          parse_mode: "Markdown",
        }),
      });
    } catch (err) {
      logger.warn("telegram reply failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
