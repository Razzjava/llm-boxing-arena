import type { SavedFight } from "../fight/runArenaFight";

export function ResultCard({ fight, onClose, onRestart, onDownload, onExit }: { fight: SavedFight; onClose: () => void; onRestart: () => void; onDownload: () => void; onExit: () => void }) {
  const { log } = fight;
  const r = log.result;
  const winner = r.winner ? log.builds[r.winner] : null;
  const clock = `${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, "0")}`;
  const rounds = r.scorecards[0]?.rounds.map((x) => x.round) ?? [];
  return (
    <div className="result" data-testid="result-card">
      <button type="button" className="close" onClick={onClose} aria-label="Hide result">×</button>
      <div className={`result-head ${r.winner === "a" ? "red" : r.winner === "b" ? "blue" : ""}`}>
        {winner ? (
          <>
            <div className="winner">{winner.name} “{winner.nickname}” wins</div>
            <div className="method">
              by {r.method} · round {r.round}
              {r.method === "KO" || r.method === "TKO" ? ` at ${clock}` : ""}
            </div>
          </>
        ) : (
          <div className="winner">{r.method === "draw" ? "It's a draw" : r.method}</div>
        )}
        <div className="reason">{r.reason}</div>
        <div className="small muted">
          🔴 {fight.meta.a.label} vs 🔵 {fight.meta.b.label} · seed {log.seed}
        </div>
      </div>
      <h3>Scorecards</h3>
      <div className="cards-wrap">
        <table className="cards" data-testid="scorecards">
          <thead>
            <tr>
              <th>Judge</th>
              {rounds.map((n) => (
                <th key={n}>R{n}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {r.scorecards.map((c) => (
              <tr key={c.judge}>
                <td>
                  {c.judge}
                  <div className="small muted">likes {c.bias}</div>
                </td>
                {c.rounds.map((x) => (
                  <td key={x.round}>
                    <span className="red-t">{x.a}</span>-<span className="blue-t">{x.b}</span>
                  </td>
                ))}
                <td>
                  <b>
                    <span className="red-t">{c.totalA}</span>-<span className="blue-t">{c.totalB}</span>
                  </b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(r.method === "KO" || r.method === "TKO") && <p className="small muted">The fight ended inside the distance; cards show the rounds completed.</p>}
      <div className="result-actions">
        <button type="button" onClick={onRestart}>Watch again</button>
        <button type="button" onClick={onDownload} data-testid="download-log-result">Download fight log</button>
        <button type="button" onClick={onExit}>New fight</button>
      </div>
    </div>
  );
}
