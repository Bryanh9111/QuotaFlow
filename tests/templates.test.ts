import { describe, it, expect } from "vitest";
import { applyTemplate, listTemplates, TEMPLATES } from "../src/templates.js";

describe("templates", () => {
  it("applyTemplate returns correct description with project name substituted", () => {
    const result = applyTemplate("review", "MyApp");
    expect(result).not.toBeNull();
    expect(result!.description).toContain("MyApp");
    expect(result!.description).not.toContain("{project}");
  });

  it("applyTemplate returns null for unknown template", () => {
    expect(applyTemplate("nonexistent", "MyApp")).toBeNull();
  });

  it("applyTemplate returns correct size and priority for review template", () => {
    const result = applyTemplate("review", "TestProject");
    expect(result!.size).toBe("small");
    expect(result!.priority).toBe("medium");
  });

  it("applyTemplate returns correct size and priority for refactor template", () => {
    const result = applyTemplate("refactor", "TestProject");
    expect(result!.size).toBe("large");
    expect(result!.priority).toBe("low");
  });

  it("listTemplates returns formatted list containing all template keys", () => {
    const output = listTemplates();
    expect(output).toContain("review");
    expect(output).toContain("test");
    expect(output).toContain("lint");
    expect(output).toContain("docs");
    expect(output).toContain("refactor");
  });

  it("listTemplates includes size and priority info", () => {
    const output = listTemplates();
    expect(output).toContain("small");
    expect(output).toContain("medium");
    expect(output).toContain("large");
    expect(output).toContain("low");
  });

  it("all 5 templates are defined", () => {
    const keys = Object.keys(TEMPLATES);
    expect(keys).toHaveLength(5);
    expect(keys).toContain("review");
    expect(keys).toContain("test");
    expect(keys).toContain("lint");
    expect(keys).toContain("docs");
    expect(keys).toContain("refactor");
  });
});
