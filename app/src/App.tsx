import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { KeyPanel } from "./ui/KeyPanel";
import { CornerPicker, type CornerChoice } from "./ui/CornerPicker";
import { SimStatus } from "./ui/SimStatus";
import { EMPTY_KEYS, type Keys, type ModelList, type OpenCodePlan, type ProviderId } from "./providers/types";
import { loadModels } from "./providers/modelLists";
import { cornerMeta, runArenaFight, type CornerConfig, type FightStatus, type SavedFight } from "./fight/runArenaFight";
import { recordResult } from "./fight/record";
import { loadFight } from "./fight/savedFight";

const Watch = lazy(() => import("./ui/Watch"));

type Phase = "setup" | "simulating" | "watching";
type WatchMode = "live" | "replay";

function toConfig(c: CornerChoice, viaProxy: Record<ProviderId, boolean>): CornerConfig | null {
  if (c.source === "demo") return { kind: "demo", style: c.demoStyle };
  if (!c.model) return null;
  return { kind: "llm", model: c.model, viaProxy: c.source === "opencode" ? true : viaProxy[c.source] };
}

export function App() {
  // Keys exist only here, in memory. See ui/KeyPanel.tsx.
  const [keys, setKeys] = useState<Keys>(EMPTY_KEYS);
  const [plan, setPlan] = useState<OpenCodePlan>("console");
  const [viaProxy, setViaProxy] = useState<Record<ProviderId, boolean>>({ openai: false, anthropic: false, xai: false, opencode: true });
  const [proxyBase, setProxyBase] = useState("/proxy");
  const [corners, setCorners] = useState<{ a: CornerChoice; b: CornerChoice }>({
    a: { source: "demo", demoStyle: "slugger", model: null },
    b: { source: "demo", demoStyle: "outBoxer", model: null },
  });
  const [lists, setLists] = useState<Record<string, ModelList | "loading">>({});
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [phase, setPhase] = useState<Phase>("setup");
  const [status, setStatus] = useState<FightStatus | null>(null);
  const [fight, setFight] = useState<SavedFight | null>(null);
  const [watchMode, setWatchMode] = useState<WatchMode>("live");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const listKey = useCallback((p: ProviderId) => (p === "opencode" ? `opencode:${plan}` : p), [plan]);

  const listsRef = useRef(lists);
  listsRef.current = lists;
  const ensureList = useCallback(
    (p: ProviderId, force = false) => {
      const k = listKey(p);
      if (!force && listsRef.current[k]) return;
      listsRef.current = { ...listsRef.current, [k]: "loading" };
      setLists((c) => ({ ...c, [k]: "loading" }));
      void loadModels(p, keysRef.current, plan).then((list) => setLists((c) => ({ ...c, [k]: list })));
    },
    [listKey, plan],
  );

  useEffect(() => {
    for (const side of ["a", "b"] as const) {
      const s = corners[side].source;
      if (s !== "demo" && keys[s]) ensureList(s);
    }
  }, [corners, keys, ensureList]);

  // Switching Console <-> Go changes the model list and endpoints, so clear OpenCode picks.
  useEffect(() => {
    setCorners((c) => ({
      a: c.a.source === "opencode" ? { ...c.a, model: null } : c.a,
      b: c.b.source === "opencode" ? { ...c.b, model: null } : c.b,
    }));
  }, [plan]);

  // A corner whose key was cleared goes back to the demo bot.
  useEffect(() => {
    setCorners((c) => {
      const fix = (x: CornerChoice): CornerChoice => (x.source !== "demo" && !keys[x.source] ? { ...x, source: "demo", model: null } : x);
      const a = fix(c.a);
      const b = fix(c.b);
      return a === c.a && b === c.b ? c : { a, b };
    });
  }, [keys]);

  const configs = { a: toConfig(corners.a, viaProxy), b: toConfig(corners.b, viaProxy) };
  const ready = configs.a && configs.b;

  async function startFight() {
    if (!configs.a || !configs.b) return;
    setError(null);
    setPhase("simulating");
    try {
      const outcome = await runArenaFight({ a: configs.a, b: configs.b, keys, proxyBase, seed }, setStatus);
      if (outcome.status === "aborted") {
        setError(outcome.message);
        setFight(null);
        setWatchMode("live");
        setPhase("setup");
        return;
      }
      recordResult(outcome.fight);
      setFight(outcome.fight);
      setWatchMode("live");
      setPhase("watching");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("setup");
    }
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const loaded = await loadFight(await file.text());
      // A replay is playback only: recordResult is for a fight that just finished.
      setFight(loaded);
      setWatchMode("replay");
      setPhase("watching");
    } catch (err) {
      setFight(null);
      setWatchMode("live");
      setPhase("setup");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (phase === "watching" && fight) {
    return (
      <Suspense fallback={<div className="loading">Loading the arena…</div>}>
        <Watch fight={fight} mode={watchMode} onExit={() => { setPhase("setup"); setFight(null); setWatchMode("live"); }} />
      </Suspense>
    );
  }

  const labels = { a: configs.a ? cornerMeta(configs.a).label : "Red", b: configs.b ? cornerMeta(configs.b).label : "Blue" };

  return (
    <div className="setup">
      <header>
        <h1>🥊 LLM Boxing Arena</h1>
        <p className="muted">Two models build a boxer from 30 stat points, call every exchange of a 10-round fight, and a deterministic engine and three judges decide it. Then you watch it in 3D.</p>
      </header>
      {error && <div className="error" role="alert" data-testid="fight-error">{error}</div>}
      {phase === "simulating" && status ? (
        <SimStatus status={status} labels={labels} />
      ) : (
        <div className="grid">
          <KeyPanel keys={keys} onKeys={setKeys} plan={plan} onPlan={setPlan} viaProxy={viaProxy} onViaProxy={setViaProxy} proxyBase={proxyBase} onProxyBase={setProxyBase} />
          <div className="corners">
            {(["a", "b"] as const).map((side) => {
              const c = corners[side];
              return (
                <CornerPicker
                  key={side}
                  side={side}
                  choice={c}
                  keys={keys}
                  onChange={(next) => setCorners((cur) => ({ ...cur, [side]: next }))}
                  list={c.source === "demo" ? undefined : lists[listKey(c.source)]}
                  onReload={() => c.source !== "demo" && ensureList(c.source, true)}
                />
              );
            })}
            <section className="panel start">
              <label className="label" htmlFor="seed">Seed (same seed + same answers = same fight)</label>
              <input id="seed" data-testid="seed" type="number" value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              <button type="button" className="big-btn" disabled={!ready} onClick={startFight} data-testid="start-fight">
                Fight!
              </button>
            </section>
            <section
              className={`panel replay-drop${dragOver ? " drag" : ""}`}
              data-testid="replay-drop"
              aria-label="Replay a fight log"
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void onUpload(e.dataTransfer.files?.[0]);
              }}
            >
              <h2>Replay a fight log</h2>
              <p className="small muted">Drop a fight JSON here, or choose a file. Playback uses the saved log only: no model calls and no API keys.</p>
              <label className="upload">
                Choose fight log
                <input
                  type="file"
                  accept="application/json,.json"
                  data-testid="upload-log"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void onUpload(file);
                  }}
                />
              </label>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
