import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig, validateConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "quotaflow-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns default config when file does not exist", () => {
    const cfg = loadConfig(join(tmpDir, "nonexistent.json"));
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("merges top-level user values with defaults", () => {
    const override = { check_interval_minutes: 10, max_concurrency: 3 };
    const p = join(tmpDir, "config.json");
    writeFileSync(p, JSON.stringify(override));
    const cfg = loadConfig(p);
    expect(cfg.check_interval_minutes).toBe(10);
    expect(cfg.max_concurrency).toBe(3);
    expect(cfg.inactivity_threshold_minutes).toBe(DEFAULT_CONFIG.inactivity_threshold_minutes);
  });

  it("deep merges nested quota object with defaults", () => {
    const override = { quota: { safety_buffer_percent: 20 } };
    const p = join(tmpDir, "config.json");
    writeFileSync(p, JSON.stringify(override));
    const cfg = loadConfig(p);
    expect(cfg.quota.safety_buffer_percent).toBe(20);
    expect(cfg.quota.tokens_per_5h_window).toBe(DEFAULT_CONFIG.quota.tokens_per_5h_window);
    expect(cfg.quota.weekly_compute_hours).toBe(DEFAULT_CONFIG.quota.weekly_compute_hours);
  });

  it("deep merges nested timeouts object with defaults", () => {
    const override = { timeouts: { large_minutes: 90 } };
    const p = join(tmpDir, "config.json");
    writeFileSync(p, JSON.stringify(override));
    const cfg = loadConfig(p);
    expect(cfg.timeouts.large_minutes).toBe(90);
    expect(cfg.timeouts.small_minutes).toBe(DEFAULT_CONFIG.timeouts.small_minutes);
    expect(cfg.timeouts.medium_minutes).toBe(DEFAULT_CONFIG.timeouts.medium_minutes);
  });

  it("returns defaults on malformed JSON", () => {
    const p = join(tmpDir, "bad.json");
    writeFileSync(p, "{ not valid json !!!");
    const cfg = loadConfig(p);
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults on empty file", () => {
    const p = join(tmpDir, "empty.json");
    writeFileSync(p, "");
    const cfg = loadConfig(p);
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });
});

describe("validateConfig", () => {
  it("accepts valid default config without throwing", () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it("accepts valid custom config without throwing", () => {
    const cfg = loadConfig(join(tmpDir, "nonexistent.json"));
    cfg.check_interval_minutes = 1;
    cfg.max_concurrency = 2;
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it("throws on negative check_interval_minutes", () => {
    const cfg = { ...DEFAULT_CONFIG, quota: { ...DEFAULT_CONFIG.quota }, timeouts: { ...DEFAULT_CONFIG.timeouts } };
    cfg.check_interval_minutes = -1;
    expect(() => validateConfig(cfg)).toThrow(/check_interval_minutes/);
  });

  it("throws on negative safety_buffer_percent", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      quota: { ...DEFAULT_CONFIG.quota, safety_buffer_percent: -5 },
      timeouts: { ...DEFAULT_CONFIG.timeouts },
    };
    expect(() => validateConfig(cfg)).toThrow(/safety_buffer_percent/);
  });

  it("throws on negative inactivity_threshold_minutes", () => {
    const cfg = { ...DEFAULT_CONFIG, quota: { ...DEFAULT_CONFIG.quota }, timeouts: { ...DEFAULT_CONFIG.timeouts } };
    cfg.inactivity_threshold_minutes = -10;
    expect(() => validateConfig(cfg)).toThrow(/inactivity_threshold_minutes/);
  });

  it("throws on max_concurrency less than 1", () => {
    const cfg = { ...DEFAULT_CONFIG, quota: { ...DEFAULT_CONFIG.quota }, timeouts: { ...DEFAULT_CONFIG.timeouts } };
    cfg.max_concurrency = 0;
    expect(() => validateConfig(cfg)).toThrow(/max_concurrency/);
  });

  it("throws on negative tokens_per_5h_window", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      quota: { ...DEFAULT_CONFIG.quota, tokens_per_5h_window: -1 },
      timeouts: { ...DEFAULT_CONFIG.timeouts },
    };
    expect(() => validateConfig(cfg)).toThrow(/tokens_per_5h_window/);
  });
});
