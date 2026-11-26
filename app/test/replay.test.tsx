import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEMO_BUILDS, DEMO_CONTROLLERS, runFight } from "@llm-boxing-arena/engine";
import { App } from "../src/App";
import { arenaStats, fightHistory, resetArenaRecord } from "../src/fight/record";
import { serializeFight } from "../src/fight/savedFight";
import type { SavedFight } from "../src/fight/runArenaFight";

const shown = vi.hoisted(() => ({ fight: null as SavedFight | null, mode: "" }));

vi.mock("../src/ui/Watch", () => ({
  default: function WatchMock({ fight, mode, onExit }: { fight: SavedFight; mode: "live" | "replay"; onExit: () => void }) {
    shown.fight = fight;
    shown.mode = mode;
    return (
      <div data-testid="watch" data-mode={mode}>
        {mode === "replay" && <div data-testid="replay-badge">Replay</div>}
        <div data-testid="watch-result">{fight.log.result.method} round {fight.log.result.round} {fight.log.result.winner ?? "none"}</div>
        <button type="button" onClick={onExit}>New fight</button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  shown.fight = null;
  shown.mode = "";
  resetArenaRecord();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installSpies() {
  const fetchMock = vi.fn(() => Promise.reject(new Error("replay must not fetch")));
  vi.stubGlobal("fetch", fetchMock);
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const idbOpen = vi.fn();
  vi.stubGlobal("indexedDB", { open: idbOpen });
  return { fetchMock, setItem, idbOpen };
}

async function seedLog(): Promise<string> {
  const outcome = await runFight(DEMO_BUILDS.slugger, DEMO_BUILDS.swarmer, DEMO_CONTROLLERS.slugger, DEMO_CONTROLLERS.swarmer, 11);
  if (outcome.status !== "completed") throw new Error(outcome.reason);
  const fight: SavedFight = {
    app: "llm-boxing-arena",
    version: 1,
    meta: { a: { label: "Demo bot (slugger)" }, b: { label: "Demo bot (swarmer)" } },
    log: outcome.log,
  };
  return serializeFight(fight, new Date("2026-11-26T12:00:00Z"));
}

describe("replaying a fight log", () => {
  it("plays a completed fight and then a file replay without fetching or recording a second result", async () => {
    const { fetchMock, setItem, idbOpen } = installSpies();
    render(<App />);
    fireEvent.click(screen.getByTestId("start-fight"));
    await screen.findByTestId("watch");
    expect(shown.mode).toBe("live");
    expect(screen.queryByTestId("replay-badge")).toBeNull();
    const afterLive = arenaStats();
    expect(afterLive.fights).toBe(1);
    expect(fightHistory()).toHaveLength(1);
    const live = shown.fight;
    expect(live?.log.result.method).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New fight" }));

    const file = new File([serializeFight(live as SavedFight)], "fight.json", { type: "application/json" });
    fireEvent.change(screen.getByTestId("upload-log"), { target: { files: [file] } });
    await screen.findByTestId("replay-badge");
    expect(shown.mode).toBe("replay");
    expect(screen.getByTestId("watch-result").textContent).toBe(
      `${live?.log.result.method} round ${live?.log.result.round} ${live?.log.result.winner ?? "none"}`,
    );
    expect(fightHistory()).toHaveLength(1);
    expect(arenaStats()).toEqual(afterLive);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(idbOpen).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "New fight" }));
    expect(screen.queryByTestId("watch")).toBeNull();
    expect(screen.queryByText(/wins by/)).toBeNull();
    expect(fightHistory()).toHaveLength(1);
  });

  it("accepts a dropped file the same way and still records nothing new", async () => {
    const { fetchMock, setItem } = installSpies();
    const before = arenaStats();
    render(<App />);
    const file = new File([await seedLog()], "demo-fight-seed-11.json", { type: "application/json" });
    fireEvent.dragOver(screen.getByTestId("replay-drop"));
    expect(screen.getByTestId("replay-drop").className).toContain("drag");
    fireEvent.drop(screen.getByTestId("replay-drop"), { dataTransfer: { files: [file] } });
    await screen.findByTestId("replay-badge");
    expect(screen.getByTestId("watch-result").textContent).toMatch(/TKO/);
    expect(fightHistory()).toEqual([]);
    expect(arenaStats()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("stops on an incompatible log and does not open the fight", async () => {
    installSpies();
    const text = await seedLog();
    const tampered = JSON.parse(text) as { log: { result: { winner: string } } };
    tampered.log.result.winner = tampered.log.result.winner === "a" ? "b" : "a";
    render(<App />);
    const file = new File([JSON.stringify(tampered)], "tampered.json", { type: "application/json" });
    fireEvent.change(screen.getByTestId("upload-log"), { target: { files: [file] } });
    const alert = await screen.findByTestId("fight-error");
    expect(alert.textContent).toMatch(/Incompatible log/);
    expect(screen.queryByTestId("watch")).toBeNull();
    expect(screen.queryByTestId("replay-badge")).toBeNull();
    expect(fightHistory()).toEqual([]);
    expect(arenaStats()).toEqual({ fights: 0, knockouts: 0 });
  });
});
