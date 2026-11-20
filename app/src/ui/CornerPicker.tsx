import type { DemoStyle } from "@llm-boxing-arena/engine";
import type { Keys, ModelInfo, ModelList, ProviderId } from "../providers/types";
import { PROVIDER_IDS, PROVIDER_LABELS } from "../providers/types";
import { ModelPicker } from "./ModelPicker";

export interface CornerChoice {
  source: "demo" | ProviderId;
  demoStyle: DemoStyle;
  model: ModelInfo | null;
}

const DEMO_LABELS: Record<DemoStyle, string> = { outBoxer: "Out-boxer (Silas 'Silk' Vane)", swarmer: "Swarmer (Marco 'Buzzsaw' Reyes)", slugger: "Slugger (Big Tom 'The Hammer' Hale)" };

interface Props {
  side: "a" | "b";
  choice: CornerChoice;
  onChange: (c: CornerChoice) => void;
  keys: Keys;
  list: ModelList | "loading" | undefined;
  onReload: () => void;
}

export function CornerPicker({ side, choice, onChange, keys, list, onReload }: Props) {
  const corner = side === "a" ? "red" : "blue";
  return (
    <section className={`panel corner ${corner}`} data-testid={`corner-${corner}`}>
      <h2>{corner === "red" ? "🔴 Red corner" : "🔵 Blue corner"}</h2>
      <label className="label" htmlFor={`src-${side}`}>Fighter</label>
      <select
        id={`src-${side}`}
        data-testid={`source-${corner}`}
        value={choice.source}
        onChange={(e) => onChange({ ...choice, source: e.target.value as CornerChoice["source"], model: null })}
      >
        <option value="demo">Demo bot (no key needed)</option>
        {PROVIDER_IDS.map((p) => (
          <option key={p} value={p} disabled={!keys[p]}>
            {PROVIDER_LABELS[p]}
            {keys[p] ? "" : " (enter a key first)"}
          </option>
        ))}
      </select>
      {choice.source === "demo" ? (
        <>
          <label className="label" htmlFor={`demo-${side}`}>Style</label>
          <select id={`demo-${side}`} data-testid={`demo-${corner}`} value={choice.demoStyle} onChange={(e) => onChange({ ...choice, demoStyle: e.target.value as DemoStyle })}>
            {(Object.keys(DEMO_LABELS) as DemoStyle[]).map((s) => (
              <option key={s} value={s}>{DEMO_LABELS[s]}</option>
            ))}
          </select>
        </>
      ) : (
        <>
          <span className="label">Model</span>
          <ModelPicker provider={choice.source} list={list} value={choice.model} onChange={(m) => onChange({ ...choice, model: m })} onReload={onReload} testId={`picker-${corner}`} />
        </>
      )}
    </section>
  );
}
