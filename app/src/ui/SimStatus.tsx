import type { FightStatus } from "../fight/runArenaFight";

export function SimStatus({ status, labels }: { status: FightStatus; labels: { a: string; b: string } }) {
  const corner = (side: "a" | "b") => (
    <div className={`sim-corner ${side === "a" ? "red" : "blue"}`}>
      <b>{labels[side]}</b>
      <div>{status.thinking[side] ? <span className="thinking">thinking…</span> : <span className="muted">ready</span>}</div>
      {status.talk[side] && <q>{status.talk[side]}</q>}
      {status.fallbacks[side] > 0 && (
        <div className="small warn-text">
          {status.fallbacks[side]} fallback answer(s){status.lastError[side] ? `: ${status.lastError[side]}` : ""}
        </div>
      )}
    </div>
  );
  return (
    <section className="panel sim" data-testid="sim-status">
      <h2>{status.phase === "building" ? "The models are building their boxers…" : `Simulating: round ${status.round}, exchange ${status.exchange || "corner"}`}</h2>
      <p className="muted small">The fight is decided first as the answers come in, then played back in 3D.</p>
      <div className="sim-row">
        {corner("a")}
        {corner("b")}
      </div>
      {status.notes.map((n) => (
        <p key={n} className="small muted">{n}</p>
      ))}
    </section>
  );
}
