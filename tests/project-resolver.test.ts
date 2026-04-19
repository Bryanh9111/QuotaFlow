import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveProject, listAllProjects } from "../src/project-resolver.js";

describe("project-resolver", () => {
  let dir: string;
  let zylo: string;
  let personal: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qf-resolver-"));
    zylo = join(dir, "Zylo");
    personal = join(dir, "Personal");
    mkdirSync(zylo, { recursive: true });
    mkdirSync(personal, { recursive: true });
    mkdirSync(join(zylo, "QuotaFlow"));
    mkdirSync(join(zylo, "Athena"));
    mkdirSync(join(zylo, "OtherApp"));
    mkdirSync(join(personal, "Blog"));
    mkdirSync(join(personal, "Dotfiles"));
    // .hidden dir should be ignored
    mkdirSync(join(zylo, ".hidden"));
    // file should be ignored
    writeFileSync(join(zylo, "README.md"), "");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("listAllProjects", () => {
    it("lists directories across all roots, skipping hidden and files", () => {
      const all = listAllProjects([zylo, personal]);
      const names = all.map((p) => p.name).sort();
      expect(names).toEqual(["Athena", "Blog", "Dotfiles", "OtherApp", "QuotaFlow"]);
    });

    it("skips non-existent roots silently", () => {
      const all = listAllProjects([zylo, "/does/not/exist"]);
      expect(all.length).toBe(3);
    });

    it("dedupes by absolute path when roots overlap", () => {
      const all = listAllProjects([zylo, zylo]);
      expect(all.length).toBe(3);
    });
  });

  describe("resolveProject", () => {
    it("exact match wins", () => {
      const out = resolveProject("QuotaFlow", [zylo, personal]);
      expect(out.hit?.name).toBe("QuotaFlow");
      expect(out.matchKind).toBe("exact");
    });

    it("case-insensitive exact when no exact", () => {
      const out = resolveProject("quotaflow", [zylo, personal]);
      expect(out.hit?.name).toBe("QuotaFlow");
      expect(out.matchKind).toBe("ci-exact");
    });

    it("prefix match when unambiguous", () => {
      const out = resolveProject("Quot", [zylo, personal]);
      expect(out.hit?.name).toBe("QuotaFlow");
      expect(out.matchKind).toBe("prefix");
    });

    it("substring match when unambiguous", () => {
      // "uota" appears in "QuotaFlow" but no other project
      const out = resolveProject("uota", [zylo, personal]);
      expect(out.hit?.name).toBe("QuotaFlow");
      expect(out.matchKind).toBe("substring");
    });

    it("returns null hit on unknown name with empty candidates", () => {
      const out = resolveProject("XyzNotReal", [zylo, personal]);
      expect(out.hit).toBeNull();
      expect(out.candidates.length).toBe(0);
      expect(out.matchKind).toBe("none");
    });

    it("returns candidates on ambiguous prefix", () => {
      // "A" prefix matches Athena but not others -> single, still ok
      // Need actual ambiguity: create another dir with same prefix
      mkdirSync(join(zylo, "Atlas"));
      const out = resolveProject("At", [zylo, personal]);
      expect(out.hit).toBeNull();
      expect(out.candidates.length).toBe(2);
      expect(out.candidates.map((c) => c.name).sort()).toEqual(["Athena", "Atlas"]);
    });

    it("absolute path accepted if inside a configured root", () => {
      const out = resolveProject(join(zylo, "QuotaFlow"), [zylo, personal]);
      expect(out.hit?.name).toBe("QuotaFlow");
      expect(out.matchKind).toBe("absolute");
    });

    it("absolute path rejected if outside configured roots", () => {
      mkdirSync(join(dir, "Outside"));
      mkdirSync(join(dir, "Outside", "Evil"));
      const out = resolveProject(join(dir, "Outside", "Evil"), [zylo, personal]);
      expect(out.hit).toBeNull();
    });

    it("earlier root wins on duplicate names", () => {
      mkdirSync(join(personal, "Athena"));
      const out = resolveProject("Athena", [zylo, personal]);
      expect(out.hit?.root).toBe(zylo);
    });

    it("empty name returns none", () => {
      const out = resolveProject("", [zylo, personal]);
      expect(out.hit).toBeNull();
      expect(out.matchKind).toBe("none");
    });

    it("empty roots returns none", () => {
      const out = resolveProject("QuotaFlow", []);
      expect(out.hit).toBeNull();
    });
  });
});
