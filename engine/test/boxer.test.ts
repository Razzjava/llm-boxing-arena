import { describe, expect, it } from "vitest";
import { acceptBuild, checkBuild, realPersonReason } from "../src/boxer.js";
import { DEMO_BUILDS } from "../src/controllers.js";
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

  it("rejects real people and textbook personal names, and keeps stage names", () => {
    const rejected = [
      "Mike Tyson", "MIKE TYSON", "mike-tyson", "mike.tyson", "Tyson", "tyson.", "  TYSON  ",
      "Ali", "ali", "Canelo", "Canelo!", "Canelo Álvarez", "Muhammad Ali", "mohammed ali",
      "Saul Alvarez", "Floyd Mayweather", "Iron Mike", "Sugar Ray", "The Rock",
      "Dr. Tyson", "Mike Tyson Jr.", "Mr. Mike Tyson", "John Smith", "jane doe", "Joe Bloggs",
      "Tom Brady", "Taylor Swift", "LeBron James", "Donald Trump", "young Mike Tyson",
    ];
    for (const name of rejected) {
      const cleaned = name.replace(/\s+/g, " ").trim().slice(0, 24);
      const n = acceptBuild({ ...OUT, name, nickname: "The Ghost" });
      expect(n.ok, name).toBe(false);
      if (!n.ok) expect(n.reason).toBe(realPersonReason(cleaned));
    }

    const nickname = acceptBuild({ ...OUT, name: "The Ghost", nickname: "Ali" });
    expect(nickname.ok).toBe(false);
    if (!nickname.ok) expect(nickname.reason).toBe(realPersonReason("Ali"));

    const nameFirst = acceptBuild({ ...OUT, name: "Mike Tyson", nickname: "Ali" });
    expect(nameFirst.ok).toBe(false);
    if (!nameFirst.ok) expect(nameFirst.reason).toBe(realPersonReason("Mike Tyson"));

    const stage = ["The Ghost", "Iron Tide", "Silk", "Buzzsaw", "The Hammer", "The Kid", "Night Wolf", "The Fury", "Swift", "Jack Hammer", "Rocky", "Sugar"];
    for (const name of stage) {
      const n = acceptBuild({ ...OUT, name, nickname: "Iron Tide" });
      expect(n.ok, name).toBe(true);
      if (n.ok) expect(n.build.name).toBe(name);
    }

    for (const build of Object.values(DEMO_BUILDS)) {
      expect(checkBuild(build), build.name).toEqual([]);
      const n = acceptBuild(build);
      expect(n.ok, build.name).toBe(true);
      if (n.ok) expect(n.build).toEqual(build);
    }

    // Replay validation stays structural, so a stored personal name is not re-judged.
    expect(checkBuild({ ...OUT, name: "Mike Tyson" })).toEqual([]);
  });
});
