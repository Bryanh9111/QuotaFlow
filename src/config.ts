import { readFileSync } from "fs";
import { Config, DEFAULT_CONFIG } from "./types.js";

/** Normalize projects_root + projects_roots into a single array. Single-root configs still work. */
export function getProjectsRoots(config: Config): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of config.projects_roots ?? []) {
    if (r && !seen.has(r)) { out.push(r); seen.add(r); }
  }
  if (config.projects_root && !seen.has(config.projects_root)) {
    out.push(config.projects_root);
    seen.add(config.projects_root);
  }
  return out;
}

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
  if (config.projects_roots && !Array.isArray(config.projects_roots)) {
    throw new Error("projects_roots must be an array of strings");
  }
  if (config.projects_roots) {
    for (const r of config.projects_roots) {
      if (typeof r !== "string") throw new Error("projects_roots entries must be strings");
    }
  }
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
