export type TaskPriority = "high" | "medium" | "low";
export type TaskSize = "small" | "medium" | "large" | "xlarge";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface Task {
  id: string;
  description: string;
  project: string;
  priority: TaskPriority;
  size: TaskSize;
  status: TaskStatus;
  created_at: string;
  completed_at?: string;
  tokens_used?: number;
  branch?: string;
  duration_ms?: number;
  error?: string;
}

export interface TaskQueue {
  tasks: Task[];
}

export interface Config {
  projects_root: string;
  projects_roots: string[];
  inactivity_threshold_minutes: number;
  check_interval_minutes: number;
  max_concurrency: number;
  discord_webhook_url: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  telegram_command_secret: string;
  default_project: string;
  default_size: TaskSize;
  default_priority: TaskPriority;
  quota: {
    tokens_per_5h_window: number;
    weekly_compute_hours: number;
    safety_buffer_percent: number;
  };
  timeouts: {
    small_minutes: number;
    medium_minutes: number;
    large_minutes: number;
    xlarge_minutes: number;
  };
  daily_report_hour: number;
  weekly_report_day: number;
}

export interface RateLimitInfo {
  status: string;         // "allowed", "allowed_warning", or "rejected"
  rateLimitType: string;  // "five_hour" or "seven_day"
  resetsAt: number;       // Unix timestamp
  isUsingOverage: boolean;
  utilization?: number;   // 0.0-1.0, percentage used
}

export interface ExecutionResult {
  task_id: string;
  success: boolean;
  branch: string;
  tokens_used: number;
  duration_ms: number;
  stdout: string;
  stderr: string;
  error?: string;
  rate_limit?: RateLimitInfo;
  weekly_rate_limit?: RateLimitInfo;
}

export const DEFAULT_CONFIG: Config = {
  projects_root: "",
  projects_roots: [],
  inactivity_threshold_minutes: 15,
  check_interval_minutes: 5,
  max_concurrency: 1,
  discord_webhook_url: "",
  telegram_bot_token: "",
  telegram_chat_id: "",
  telegram_command_secret: "",
  default_project: "",
  default_size: "medium",
  default_priority: "medium",
  quota: {
    tokens_per_5h_window: 88000,
    weekly_compute_hours: 200,
    safety_buffer_percent: 10,
  },
  timeouts: {
    small_minutes: 5,
    medium_minutes: 15,
    large_minutes: 45,
    xlarge_minutes: 90,
  },
  daily_report_hour: 8,
  weekly_report_day: 1,
};

// Token estimates calibrated against real observations.
// Real data: a large planning task consumed 908K tokens (15x the old large=60K).
// These are conservative defaults - estimator learns from history after 3 samples.
export const SIZE_TOKEN_ESTIMATES: Record<TaskSize, number> = {
  small: 15000,     // bug fix, small review
  medium: 60000,    // feature implementation, tests
  large: 200000,    // multi-file refactor, full analysis
  xlarge: 800000,   // engineering plans, comprehensive audits
};
