// Searchable model dropdown, grouped by family, with context size and a rough cost per fight.
import { useMemo, useState } from "react";
import type { ModelInfo, ModelList, ProviderId } from "../providers/types";
import { direct, groupByFamily } from "../providers/modelLists";
import { estimateFightCost, formatContext, formatCost } from "../providers/cost";

interface Props {
  provider: ProviderId;
  list: ModelList | "loading" | undefined;
  value: ModelInfo | null;
  onChange: (m: ModelInfo) => void;
  onReload: () => void;
  testId: string;
}

export function ModelPicker({ provider, list, value, onChange, onReload, testId }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const models = list && list !== "loading" ? list.models : [];
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q ? models.filter((m) => `${m.id} ${m.name} ${m.family}`.toLowerCase().includes(q)) : models;
  }, [models, query]);
  const groups = groupByFamily(filtered);
  const canCustom = provider !== "opencode" && query.trim() && !models.some((m) => m.id === query.trim());

  return (
    <div className="picker" data-testid={testId}>
      <div className="picker-head">
        <button type="button" className="picker-value" onClick={() => setOpen(!open)} data-testid={`${testId}-toggle`}>
          {value ? (
            <>
              <b>{value.name}</b> <span className="muted">{value.id !== value.name ? value.id : ""}</span>
            </>
          ) : list === "loading" ? (
            "Loading models…"
          ) : (
            "Choose a model…"
          )}
        </button>
        <button type="button" className="icon" title="Reload model list" onClick={onReload}>
          ↻
        </button>
      </div>
      {list && list !== "loading" && (
        <div className="small muted" data-testid={`${testId}-source`}>
          {list.source === "live" ? `${models.length} models loaded live` : `Using built-in list${list.error ? `: ${list.error}` : ""}`}
        </div>
      )}
      {open && (
        <div className="picker-pop">
          <input autoFocus placeholder="Search models…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid={`${testId}-search`} />
          <div className="picker-list">
            {canCustom && (
              <button type="button" className="opt" onClick={() => { onChange(direct(provider as Exclude<ProviderId, "opencode">, query.trim())); setOpen(false); }}>
                Use custom model id “{query.trim()}”
              </button>
            )}
            {groups.map(([family, ms]) => (
              <div key={family} className="group">
                <div className="group-name">{family}</div>
                {ms.map((m) => (
                  <button type="button" key={m.id} className={`opt ${value?.id === m.id ? "on" : ""}`} onClick={() => { onChange(m); setOpen(false); }} data-testid="model-option" data-model-id={m.id}>
                    <span className="opt-name">{m.name}</span>
                    <span className="opt-meta">
                      {formatContext(m.contextTokens)} {provider === "opencode" ? `· ${formatCost(estimateFightCost(m.inputPrice, m.outputPrice))}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && !canCustom && <div className="muted small">No models match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
