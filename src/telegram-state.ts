import { readFileSync, writeFileSync, existsSync } from "fs";

interface StateShape {
  last_update_id: number;
  processed_msg_ids: number[];
}

const DEFAULT_STATE: StateShape = {
  last_update_id: 0,
  processed_msg_ids: [],
};

const MAX_PROCESSED_CACHE = 200;

export class TelegramState {
  private filePath: string;
  private state: StateShape;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.state = this.load();
  }

  private load(): StateShape {
    if (!existsSync(this.filePath)) return { ...DEFAULT_STATE, processed_msg_ids: [] };
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StateShape>;
      return {
        last_update_id: typeof parsed.last_update_id === "number" ? parsed.last_update_id : 0,
        processed_msg_ids: Array.isArray(parsed.processed_msg_ids)
          ? parsed.processed_msg_ids.slice(-MAX_PROCESSED_CACHE)
          : [],
      };
    } catch {
      return { ...DEFAULT_STATE, processed_msg_ids: [] };
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch {
      // Don't crash poller on disk failure; next tick retries.
    }
  }

  getLastUpdateId(): number {
    return this.state.last_update_id;
  }

  setLastUpdateId(id: number): void {
    if (id > this.state.last_update_id) {
      this.state.last_update_id = id;
      this.persist();
    }
  }

  isProcessed(messageId: number): boolean {
    return this.state.processed_msg_ids.includes(messageId);
  }

  markProcessed(messageId: number): void {
    if (this.state.processed_msg_ids.includes(messageId)) return;
    this.state.processed_msg_ids.push(messageId);
    if (this.state.processed_msg_ids.length > MAX_PROCESSED_CACHE) {
      this.state.processed_msg_ids = this.state.processed_msg_ids.slice(-MAX_PROCESSED_CACHE);
    }
    this.persist();
  }
}
