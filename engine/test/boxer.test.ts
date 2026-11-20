import { describe, expect, it } from "vitest";
import { checkBuild, normalizeBuild, DEFAULT_BUILD } from "../src/boxer.js";
import { OUT } from "./helpers.js";

const total = (s: Record<string, number>) => Object.values(s).reduce((a, b) => a + b, 0);

describe("boxer builds", () => {
  it("accepts a legal 30-point build unchanged", () => {
    expect(checkBuild(OUT)).toEqual([]);
    const n = normalizeBuild(OUT);
    expect(n.build).toEqual(OUT);
    expect(n.fixes).toEqual([]);
  });

  it("rejects an all-10s build and repairs it to exactly 30 points within 1-10", () => {
    const greedy = { ...OUT, stats: { power: 10, speed: 10, accuracy: 10, defence: 10, chin: 10, stamina: 10 } };
    expect(checkBuild(greedy).join()).toMatch(/total 30/);
    const { build, fixes } = normalizeBuild(greedy);
    expect(total(build.stats as never)).toBe(30);
    expect(fixes.join()).toMatch(/rescaled/);
  });

  it("clamps out-of-range, fractional and missing stats", () => {
    const messy = { name: "X", stance: "southpaw", style: "slugger", stats: { power: 99, speed: -4, accuracy: 3.6, defence: "7", chin: null } };
    const { build } = normalizeBuild(messy);
    for (const v of Object.values(build.stats)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(total(build.stats as never)).toBe(30);
    expect(checkBuild(build)).toEqual([]);
  });

  it("falls back to the default fighter for garbage", () => {
    for (const junk of [null, "punch hard", 42, [], { name: "no stats" }]) {
      const n = normalizeBuild(junk, "Boxer A");
      expect(n.usedDefault).toBe(true);
      expect(n.build.stats).toEqual(DEFAULT_BUILD.stats);
      expect(n.build.name).toBe("Boxer A");
    }
  });

  it("cleans names and defaults bad stance/style", () => {
    const { build } = normalizeBuild({ ...OUT, name: "  <script>alert(1)</script> Very Long Name Indeed Yes ", stance: "both", style: "Counter Puncher" });
    expect(build.name).not.toMatch(/[<>]/);
    expect(build.name.length).toBeLessThanOrEqual(24);
    expect(build.stance).toBe("orthodox");
    expect(build.style).toBe("counter-puncher");
  });
});
