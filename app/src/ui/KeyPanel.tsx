// API keys. They live in React state in this tab only: never written to localStorage, sessionStorage,
// cookies or IndexedDB, never logged, never put in a URL. Reloading the page clears them.
import type { Keys, OpenCodePlan, ProviderId } from "../providers/types";
import { PROVIDER_IDS, PROVIDER_LABELS } from "../providers/types";

interface Props {
  keys: Keys;
  onKeys: (k: Keys) => void;
  plan: OpenCodePlan;
  onPlan: (p: OpenCodePlan) => void;
  viaProxy: Record<ProviderId, boolean>;
  onViaProxy: (v: Record<ProviderId, boolean>) => void;
  proxyBase: string;
  onProxyBase: (s: string) => void;
}

const PLACEHOLDER: Record<ProviderId, string> = { openai: "sk-...", anthropic: "sk-ant-...", xai: "xai-...", opencode: "OpenCode API key" };

export function KeyPanel({ keys, onKeys, plan, onPlan, viaProxy, onViaProxy, proxyBase, onProxyBase }: Props) {
  return (
    <section className="panel keys">
      <h2>API keys</h2>
      <p className="note" data-testid="key-note">
        🔒 Keys stay in this tab's memory only. They are not saved anywhere (no local storage, cookies or
        database), never logged and never put in a URL. Reloading the page clears them. Calls go from your
        browser straight to the provider, or through the local proxy on your own machine for OpenCode.
      </p>
      {PROVIDER_IDS.map((id) => (
        <div className="key-row" key={id}>
          <label htmlFor={`key-${id}`}>{PROVIDER_LABELS[id]}</label>
          <input
            id={`key-${id}`}
            data-testid={`key-${id}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            placeholder={PLACEHOLDER[id]}
            value={keys[id]}
            onChange={(e) => onKeys({ ...keys, [id]: e.target.value.trim() })}
          />
          {id !== "opencode" ? (
            <label className="small" title="Route this provider through the local proxy instead of calling it directly from the browser">
              <input type="checkbox" checked={viaProxy[id]} onChange={(e) => onViaProxy({ ...viaProxy, [id]: e.target.checked })} /> Send via local proxy
            </label>
          ) : (
            <span className="small muted">always via local proxy (OpenCode blocks browser calls)</span>
          )}
        </div>
      ))}
      <div className="key-row">
        <span className="label">OpenCode plan</span>
        <div className="seg" role="radiogroup" aria-label="OpenCode plan">
          <button type="button" role="radio" aria-checked={plan === "console"} className={plan === "console" ? "on" : ""} onClick={() => onPlan("console")} data-testid="plan-console">
            Console (pay as you go)
          </button>
          <button type="button" role="radio" aria-checked={plan === "go"} className={plan === "go" ? "on" : ""} onClick={() => onPlan("go")} data-testid="plan-go">
            Go (subscription)
          </button>
        </div>
      </div>
      {plan === "go" && (
        <p className="warn" data-testid="go-warning">
          ⚠️ Use at your own risk: OpenCode says Go is meant for coding-agent traffic, and they monitor for misuse.
        </p>
      )}
      <details className="small">
        <summary>Proxy address</summary>
        <input value={proxyBase} onChange={(e) => onProxyBase(e.target.value.trim())} aria-label="Proxy base URL" />
        <p className="muted">
          "/proxy" works under <code>npm run dev</code> and <code>npm run preview</code>. If you serve the built files elsewhere, run{" "}
          <code>npm run proxy</code> and use http://localhost:8787/proxy.
        </p>
      </details>
    </section>
  );
}
