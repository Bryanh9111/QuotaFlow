import type { TaskPriority, TaskSize } from "./types.js";

export type ParsedCommand =
  | { kind: "add"; description: string; project?: string; size?: TaskSize; priority?: TaskPriority }
  | { kind: "list"; limit?: number }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "rm"; id: string }
  | { kind: "unknown"; raw: string }
  | { kind: "empty" };

const VALID_SIZES: TaskSize[] = ["small", "medium", "large", "xlarge"];
const VALID_PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

/**
 * Parse Telegram command after passphrase + chat_id have already been verified.
 * Input is the raw text WITHOUT the passphrase prefix.
 */
export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };

  // Slash commands
  if (trimmed.startsWith("/")) {
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const body = rest.join(" ").trim();
    switch (cmd.toLowerCase()) {
      case "/list": {
        const n = parseInt(body, 10);
        return { kind: "list", limit: Number.isFinite(n) && n > 0 ? n : undefined };
      }
      case "/status":
        return { kind: "status" };
      case "/help":
        return { kind: "help" };
      case "/rm": {
        if (!body) return { kind: "unknown", raw: trimmed };
        return { kind: "rm", id: body.split(/\s+/)[0] };
      }
      case "/add":
        return parseAdd(body);
      default:
        return { kind: "unknown", raw: trimmed };
    }
  }

  // Plain text → treat as /add with defaults
  return parseAdd(trimmed);
}

function parseAdd(body: string): ParsedCommand {
  if (!body) return { kind: "empty" };

  const tokens = body.split(/\s+/);
  const kv: Record<string, string> = {};
  let descStart = 0;

  // Leading @Name → project shortcut (before any key=value)
  let atProject: string | undefined;
  if (tokens[0]?.startsWith("@") && tokens[0].length > 1) {
    atProject = tokens[0].slice(1);
    descStart = 1;
  }

  // Remaining key=value pairs from the start, rest is description
  for (let i = descStart; i < tokens.length; i++) {
    const m = tokens[i].match(/^(proj|project|size|pri|priority)=(.+)$/i);
    if (!m) {
      descStart = i;
      break;
    }
    kv[m[1].toLowerCase()] = m[2];
    descStart = i + 1;
  }

  const description = tokens.slice(descStart).join(" ").trim();
  if (!description) return { kind: "empty" };

  const project = kv.project ?? kv.proj ?? atProject;
  const sizeRaw = kv.size?.toLowerCase();
  const priRaw = (kv.priority ?? kv.pri)?.toLowerCase();

  const size = sizeRaw && (VALID_SIZES as string[]).includes(sizeRaw)
    ? (sizeRaw as TaskSize)
    : undefined;
  const priority = priRaw && (VALID_PRIORITIES as string[]).includes(priRaw)
    ? (priRaw as TaskPriority)
    : undefined;

  return { kind: "add", description, project, size, priority };
}
