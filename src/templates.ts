import type { TaskSize, TaskPriority } from "./types.js";

export interface TaskTemplate {
  name: string;
  description: string;
  size: TaskSize;
  priority: TaskPriority;
}

export const TEMPLATES: Record<string, TaskTemplate> = {
  review: {
    name: "Code Review",
    description: "Review recent changes in {project} for bugs, security issues, and code quality",
    size: "small",
    priority: "medium",
  },
  test: {
    name: "Write Tests",
    description: "Write unit tests for uncovered code in {project}, aim for >80% coverage",
    size: "medium",
    priority: "medium",
  },
  lint: {
    name: "Lint & Fix",
    description: "Run linting on {project} and fix all auto-fixable issues",
    size: "small",
    priority: "low",
  },
  docs: {
    name: "Update Docs",
    description: "Update README and inline documentation in {project} to match current code",
    size: "small",
    priority: "low",
  },
  refactor: {
    name: "Refactor",
    description: "Identify and refactor the most complex functions in {project} for readability",
    size: "large",
    priority: "low",
  },
};

export function applyTemplate(
  templateName: string,
  project: string
): { description: string; size: TaskSize; priority: TaskPriority } | null {
  const tmpl = TEMPLATES[templateName];
  if (!tmpl) return null;
  return {
    description: tmpl.description.replace(/\{project\}/g, project),
    size: tmpl.size,
    priority: tmpl.priority,
  };
}

export function listTemplates(): string {
  return Object.entries(TEMPLATES)
    .map(([key, t]) => `  ${key.padEnd(10)} - ${t.name} (${t.size}, ${t.priority})`)
    .join("\n");
}
