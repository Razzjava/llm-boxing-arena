import type { Side } from "@llm-boxing-arena/engine";
import type { SavedFight } from "../fight/runArenaFight";
import type { Vitals } from "../playback/timeline";
import type { Line } from "../playback/commentary";

function Bar({ value, kind }: { value: number; kind: "head" | "body" | "stamina" }) {
  return (
    <div className={`bar ${kind}`} title={`${kind} ${Math.round(value)}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function Card({ fight, side, v }: { fight: SavedFight; side: Side; v: Vitals }) {
  const b = fight.log.builds[side];
  return (
    <div className={`hud-card ${side === "a" ? "red" : "blue"}`} data-testid={`hud-${side === "a" ? "red" : "blue"}`}>
      <div className="hud-name">
        {b.name} <span className="nick">“{b.nickname}”</span>
      </div>
      <div className="hud-meta">
        {fight.meta[side].label} · {b.style}, {b.stance}
      </div>
      <Bar value={v.head} kind="head" />
      <Bar value={v.body} kind="body" />
      <Bar value={v.stamina} kind="stamina" />
      <div className="hud-flags">
        {v.knockdowns > 0 && <span>⬇ {v.knockdowns}</span>}
        {v.cut > 0 && <span>🩸 cut {v.cut}</span>}
        {v.hurt && <span className="hurt">HURT</span>}
      </div>
    </div>
  );
}

export function Hud({ fight, vitals, clock, lines }: { fight: SavedFight; vitals: { a: Vitals; b: Vitals }; clock: { round: number; label: string }; lines: Line[] }) {
  const name = (s?: Side) => (s ? fight.log.builds[s].nickname || fight.log.builds[s].name : "");
  return (
    <>
      <div className="hud-top" data-testid="hud">
        <Card fight={fight} side="a" v={vitals.a} />
        <div className="hud-clock" data-testid="hud-clock">
          <div className="round">ROUND {clock.round}</div>
          <div className="time">{clock.label}</div>
        </div>
        <Card fight={fight} side="b" v={vitals.b} />
      </div>
      <div className="commentary" data-testid="commentary">
        {lines.map((l, i) => (
          <div key={`${l.T}-${i}`} className={`line ${l.kind} ${l.side ? (l.side === "a" ? "red" : "blue") : ""}`}>
            {l.kind === "quote" ? (
              <>
                <b>{name(l.side)}:</b> “{l.text}”
              </>
            ) : (
              l.text
            )}
          </div>
        ))}
      </div>
    </>
  );
}
