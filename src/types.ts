export type TaskPriority = "high" | "medium" | "low";
export type TaskSize = "small" | "medium" | "large";
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
  inactivity_threshold_minutes: number;
  check_interval_minutes: number;
  max_concurrency: number;
  discord_webhook_url: string;
  quota: {
    tokens_per_5h_window: number;
    weekly_compute_hours: number;
    safety_buffer_percent: number;
  };
  timeouts: {
    small_minutes: number;
    medium_minutes: number;
    large_minutes: number;
  };
  daily_report_hour: number;
  weekly_report_day: number;
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
}

export const DEFAULT_CONFIG: Config = {
  projects_root: "/Users/zion/Repos/Zylo",
  inactivity_threshold_minutes: 15,
  check_interval_minutes: 5,
  max_concurrency: 1,
  discord_webhook_url: "",
  quota: {
    tokens_per_5h_window: 88000,
    weekly_compute_hours: 200,
    safety_buffer_percent: 10,
  },
  timeouts: {
    small_minutes: 5,
    medium_minutes: 15,
    large_minutes: 45,
  },
  daily_report_hour: 8,
  weekly_report_day: 1,
};

export const SIZE_TOKEN_ESTIMATES: Record<TaskSize, number> = {
  small: 10000,
  medium: 30000,
  large: 60000,
};
