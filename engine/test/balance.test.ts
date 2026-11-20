import { describe, expect, it } from "vitest";
import { runBalance } from "../src/balance.js";

describe("balance sanity over 500 seeded demo fights", () => {
  it("no style dominates, endings are mixed, punch volume is plausible", async () => {
    const r = await runBalance(500);
    for (const m of r.matchups) {
      expect(m.winsA / m.fights).toBeLessThanOrEqual(0.8);
      expect(m.winsB / m.fights).toBeLessThanOrEqual(0.8);
    }
    const decisions = r.methods.UD + r.methods.SD + r.methods.MD + r.methods.draw;
    expect(decisions / r.fights).toBeGreaterThan(0.25);
    expect(r.stoppageRate).toBeGreaterThan(0.2);
    expect(r.stoppageRate).toBeLessThan(0.75);
    expect(r.methods.KO).toBeGreaterThan(0);
    expect(r.methods.TKO).toBeGreaterThan(0);
    expect(r.avgLandedPerRoundPerBoxer).toBeGreaterThanOrEqual(10);
    expect(r.avgLandedPerRoundPerBoxer).toBeLessThanOrEqual(25);
    expect(r.fallbacks).toBe(0);
  }, 60_000);
});
