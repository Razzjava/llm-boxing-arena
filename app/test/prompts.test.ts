import { describe, expect, it } from "vitest";
import { buildSystem } from "../src/llm/prompts";

describe("boxer-pick prompt", () => {
  it("requires an original stage name and forbids real people", () => {
    for (const corner of ["red", "blue"] as const) {
      const text = buildSystem(corner);
      expect(text).toContain("create your boxer");
      expect(text).toMatch(/original stage name/i);
      expect(text).toContain("The Ghost");
      expect(text).toContain("Iron Tide");
      expect(text).toMatch(/real people's names are not allowed/i);
      expect(text).toMatch(/boxers, athletes, celebrities, politicians/);
      expect(text).toMatch(/realistic first-and-last personal name/);
      expect(text).toMatch(/stage name only/);
    }
  });
});