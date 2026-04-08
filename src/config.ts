import { readFileSync } from "fs";
import { Config, DEFAULT_CONFIG } from "./types.js";

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key in override) {
    const val = override[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        result[key] as object,
        val as Partial<object>
      );
    } else if (val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

export function loadConfig(configPath: string): Config {
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return deepMerge<Config>(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG, quota: { ...DEFAULT_CONFIG.quota }, timeouts: { ...DEFAULT_CONFIG.timeouts } };
  }
}

export function validateConfig(config: Config): void {
  if (config.check_interval_minutes < 0) {
    throw new Error("check_interval_minutes must be non-negative");
  }
  if (config.inactivity_threshold_minutes < 0) {
    throw new Error("inactivity_threshold_minutes must be non-negative");
  }
  if (config.max_concurrency < 1) {
    throw new Error("max_concurrency must be at least 1");
  }
  if (config.quota.safety_buffer_percent < 0) {
    throw new Error("quota.safety_buffer_percent must be non-negative");
  }
  if (config.quota.tokens_per_5h_window < 0) {
    throw new Error("quota.tokens_per_5h_window must be non-negative");
  }
  if (config.quota.weekly_compute_hours < 0) {
    throw new Error("quota.weekly_compute_hours must be non-negative");
  }
  if (config.timeouts.small_minutes < 0) {
    throw new Error("timeouts.small_minutes must be non-negative");
  }
  if (config.timeouts.medium_minutes < 0) {
    throw new Error("timeouts.medium_minutes must be non-negative");
  }
  if (config.timeouts.large_minutes < 0) {
    throw new Error("timeouts.large_minutes must be non-negative");
  }
  if (config.timeouts.xlarge_minutes !== undefined && config.timeouts.xlarge_minutes < 0) {
    throw new Error("timeouts.xlarge_minutes must be non-negative");
  }
}
