import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TelegramState } from "../src/telegram-state.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("TelegramState", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qf-tg-state-"));
    file = join(dir, "telegram.state.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts empty when file does not exist", () => {
    const s = new TelegramState(file);
    expect(s.getLastUpdateId()).toBe(0);
    expect(s.isProcessed(1)).toBe(false);
  });

  it("persists last_update_id to disk", () => {
    const s = new TelegramState(file);
    s.setLastUpdateId(42);
    expect(existsSync(file)).toBe(true);
    const persisted = JSON.parse(readFileSync(file, "utf-8"));
    expect(persisted.last_update_id).toBe(42);
  });

  it("reloads state from disk", () => {
    const s1 = new TelegramState(file);
    s1.setLastUpdateId(100);
    s1.markProcessed(5);
    s1.markProcessed(7);

    const s2 = new TelegramState(file);
    expect(s2.getLastUpdateId()).toBe(100);
    expect(s2.isProcessed(5)).toBe(true);
    expect(s2.isProcessed(7)).toBe(true);
    expect(s2.isProcessed(9)).toBe(false);
  });

  it("does not regress last_update_id to smaller value", () => {
    const s = new TelegramState(file);
    s.setLastUpdateId(100);
    s.setLastUpdateId(50);
    expect(s.getLastUpdateId()).toBe(100);
  });

  it("caps processed_msg_ids cache at 200 entries", () => {
    const s = new TelegramState(file);
    for (let i = 1; i <= 250; i++) s.markProcessed(i);
    const persisted = JSON.parse(readFileSync(file, "utf-8"));
    expect(persisted.processed_msg_ids.length).toBe(200);
    expect(persisted.processed_msg_ids[0]).toBe(51); // oldest evicted
    expect(persisted.processed_msg_ids[199]).toBe(250);
  });

  it("markProcessed is idempotent for same id", () => {
    const s = new TelegramState(file);
    s.markProcessed(42);
    s.markProcessed(42);
    const persisted = JSON.parse(readFileSync(file, "utf-8"));
    expect(persisted.processed_msg_ids).toEqual([42]);
  });

  it("handles corrupt state file by resetting", () => {
    writeFileSync(file, "not valid json");
    const s = new TelegramState(file);
    expect(s.getLastUpdateId()).toBe(0);
    expect(s.isProcessed(1)).toBe(false);
  });
});
