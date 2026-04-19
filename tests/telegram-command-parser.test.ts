import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/telegram-command-parser.js";

describe("parseCommand", () => {
  describe("empty input", () => {
    it("returns empty on empty string", () => {
      expect(parseCommand("")).toEqual({ kind: "empty" });
      expect(parseCommand("   ")).toEqual({ kind: "empty" });
    });
  });

  describe("plain text → add", () => {
    it("treats plain text as /add with no overrides", () => {
      expect(parseCommand("Fix login bug")).toEqual({
        kind: "add",
        description: "Fix login bug",
      });
    });

    it("supports leading key=value overrides in plain text", () => {
      expect(parseCommand("proj=MyApp size=large Fix it")).toEqual({
        kind: "add",
        description: "Fix it",
        project: "MyApp",
        size: "large",
      });
    });

    it("supports @Project shortcut as leading token", () => {
      expect(parseCommand("@QuotaFlow Fix login bug")).toEqual({
        kind: "add",
        description: "Fix login bug",
        project: "QuotaFlow",
      });
    });

    it("@Project works with /add and key=value together", () => {
      expect(parseCommand("/add @Athena size=large Review tests")).toEqual({
        kind: "add",
        description: "Review tests",
        project: "Athena",
        size: "large",
      });
    });

    it("explicit proj= overrides @Project if both given", () => {
      expect(parseCommand("@Foo proj=Bar Do work")).toEqual({
        kind: "add",
        description: "Do work",
        project: "Bar",
      });
    });
  });

  describe("/add command", () => {
    it("parses /add with project, size, priority", () => {
      expect(parseCommand("/add proj=MyApp size=medium pri=high Fix auth bug")).toEqual({
        kind: "add",
        description: "Fix auth bug",
        project: "MyApp",
        size: "medium",
        priority: "high",
      });
    });

    it("supports full field names project=, priority=", () => {
      expect(parseCommand("/add project=X priority=low desc here")).toEqual({
        kind: "add",
        description: "desc here",
        project: "X",
        priority: "low",
      });
    });

    it("is case-insensitive for size/priority values", () => {
      expect(parseCommand("/add size=LARGE pri=HIGH do thing")).toEqual({
        kind: "add",
        description: "do thing",
        size: "large",
        priority: "high",
      });
    });

    it("ignores invalid size/priority silently (falls back to defaults)", () => {
      const result = parseCommand("/add size=huge pri=urgent do it");
      expect(result).toEqual({
        kind: "add",
        description: "do it",
        // size and priority undefined → caller uses config defaults
      });
    });

    it("returns empty when /add has no description", () => {
      expect(parseCommand("/add")).toEqual({ kind: "empty" });
      expect(parseCommand("/add proj=X size=medium")).toEqual({ kind: "empty" });
    });
  });

  describe("/list command", () => {
    it("returns list with default limit", () => {
      expect(parseCommand("/list")).toEqual({ kind: "list" });
    });

    it("parses numeric limit", () => {
      expect(parseCommand("/list 5")).toEqual({ kind: "list", limit: 5 });
    });

    it("ignores non-numeric limit", () => {
      expect(parseCommand("/list abc")).toEqual({ kind: "list" });
    });
  });

  describe("/status /help", () => {
    it("returns status", () => {
      expect(parseCommand("/status")).toEqual({ kind: "status" });
    });
    it("returns help", () => {
      expect(parseCommand("/help")).toEqual({ kind: "help" });
    });
    it("is case-insensitive for slash command name", () => {
      expect(parseCommand("/STATUS")).toEqual({ kind: "status" });
    });
  });

  describe("/rm command", () => {
    it("parses task id", () => {
      expect(parseCommand("/rm abc12345")).toEqual({ kind: "rm", id: "abc12345" });
    });
    it("returns unknown when /rm has no id", () => {
      expect(parseCommand("/rm")).toEqual({ kind: "unknown", raw: "/rm" });
    });
  });

  describe("unknown commands", () => {
    it("unknown slash command returns unknown", () => {
      expect(parseCommand("/foobar")).toEqual({ kind: "unknown", raw: "/foobar" });
    });
  });
});
