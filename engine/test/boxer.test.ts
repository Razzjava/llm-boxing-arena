import { describe, expect, it } from "vitest";
import { acceptBuild, checkBuild } from "../src/boxer.js";
import { OUT } from "./helpers.js";

describe("boxer builds", () => {
  it("accepts a legal 30-point build unchanged", () => {
    expect(checkBuild(OUT)).toEqual([]);
    const n = acceptBuild(OUT);
    expect(n.ok).toBe(true);
    if (n.ok) expect(n.build).toEqual(OUT);
  });

  it("rejects an illegal build instead of repairing or substituting a default fighter", () => {
    const greedy = { ...OUT, stats: { power: 10, speed: 10, accuracy: 10, defence: 10, chin: 10, stamina: 10 } };
    expect(checkBuild(greedy).join()).toMatch(/total 30/);
    const scaled = acceptBuild(greedy);
    expect(scaled.ok).toBe(false);
    if (!scaled.ok) expect(scaled.reason).toMatch(/unusable response/);

    const messy = { name: "X", stance: "southpaw", style: "slugger", stats: { power: 99, speed: -4, accuracy: 3.6, defence: "7", chin: null, stamina: 5 } };
    expect(checkBuild(messy).length).toBeGreaterThan(0);
    expect(acceptBuild(messy).ok).toBe(false);

    for (const junk of [null, "punch hard", 42, [], { name: "no stats" }]) {
      const n = acceptBuild(junk);
      expect(n.ok).toBe(false);
      if (!n.ok) expect(n.reason).toMatch(/^unusable response:/);
    }
  });

  it("cleans display text on a legal build and keeps the stats", () => {
    const raw = { ...OUT, name: "  Bob <b>  ", nickname: "The Kid\n" };
    expect(checkBuild(raw)).toEqual([]);
    const n = acceptBuild(raw);
    expect(n.ok).toBe(true);
    if (n.ok) {
      expect(n.build.name).toBe("Bob b");
      expect(n.build.nickname).toBe("The Kid");
      expect(n.build.stats).toEqual(OUT.stats);
      expect(n.build.stance).toBe(OUT.stance);
      expect(n.build.style).toBe(OUT.style);
    }
  });
});
