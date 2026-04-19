import { readdirSync, statSync, existsSync } from "fs";
import { resolve, sep } from "path";

export interface ProjectHit {
  name: string;
  path: string;
  root: string;
}

export interface ResolveOutcome {
  hit: ProjectHit | null;
  candidates: ProjectHit[];
  matchKind: "exact" | "ci-exact" | "prefix" | "substring" | "absolute" | "none";
}

/** List all immediate subdirectories across all roots as candidate projects. */
export function listAllProjects(roots: string[]): ProjectHit[] {
  const out: ProjectHit[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const rootResolved = resolve(root);
    if (!existsSync(rootResolved)) continue;
    let entries: string[];
    try {
      entries = readdirSync(rootResolved);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = resolve(rootResolved, name);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({ name, path: full, root: rootResolved });
    }
  }
  return out;
}

/**
 * Resolve a project name against configured workspace roots.
 * Matching order: absolute path > exact > ci-exact > prefix > substring.
 * On ambiguity, earlier roots win (roots[0] > roots[1] > ...).
 * Returns null hit with candidates list when ambiguous or unknown.
 */
export function resolveProject(name: string, roots: string[]): ResolveOutcome {
  const trimmed = name.trim();
  if (!trimmed) {
    return { hit: null, candidates: [], matchKind: "none" };
  }

  // Absolute path: must exist and live inside one of the roots (defense in depth).
  if (trimmed.startsWith("/")) {
    const target = resolve(trimmed);
    for (const root of roots) {
      const rootResolved = resolve(root);
      if (target === rootResolved || target.startsWith(rootResolved + sep)) {
        if (existsSync(target)) {
          try {
            if (statSync(target).isDirectory()) {
              const base = target.split(sep).pop() || target;
              return {
                hit: { name: base, path: target, root: rootResolved },
                candidates: [],
                matchKind: "absolute",
              };
            }
          } catch {
            // fall through
          }
        }
      }
    }
    return { hit: null, candidates: [], matchKind: "none" };
  }

  const all = listAllProjects(roots);

  const exact = all.filter((p) => p.name === trimmed);
  if (exact.length > 0) {
    return { hit: exact[0], candidates: exact, matchKind: "exact" };
  }

  const lower = trimmed.toLowerCase();
  const ciExact = all.filter((p) => p.name.toLowerCase() === lower);
  if (ciExact.length === 1) {
    return { hit: ciExact[0], candidates: ciExact, matchKind: "ci-exact" };
  }
  if (ciExact.length > 1) {
    return { hit: ciExact[0], candidates: ciExact, matchKind: "ci-exact" };
  }

  const prefix = all.filter((p) => p.name.toLowerCase().startsWith(lower));
  if (prefix.length === 1) {
    return { hit: prefix[0], candidates: prefix, matchKind: "prefix" };
  }
  if (prefix.length > 1) {
    return { hit: null, candidates: prefix, matchKind: "prefix" };
  }

  const substring = all.filter((p) => p.name.toLowerCase().includes(lower));
  if (substring.length === 1) {
    return { hit: substring[0], candidates: substring, matchKind: "substring" };
  }
  if (substring.length > 1) {
    return { hit: null, candidates: substring, matchKind: "substring" };
  }

  return { hit: null, candidates: [], matchKind: "none" };
}
