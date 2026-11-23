# LLM Boxing Arena

Two language models each build a boxer from 30 stat points, then call every exchange of a 10-round fight.
A deterministic, seeded TypeScript engine resolves the punches and three judges score it. The app simulates
the whole fight first (with a "thinking" screen showing who is being asked what), then plays it back in a
3D ring: referee, corners, crowd, commentary, knockdown replays and scorecards.

No accounts and no server state. Keys stay in your browser tab's memory.

```
engine/   pure TypeScript fight engine (runFight / replayFight), its own tests
app/      Vite + React + TypeScript + React Three Fiber web app, plus a tiny local proxy (app/proxy)
e2e/      Playwright proof run (headless Chromium)
```

## Requirements

- Node.js 20 or newer (tested on Node 24) and npm 10 or newer
- A browser with WebGL (any recent Chrome, Edge, Firefox or Safari)
- Optional: API keys for OpenAI, Anthropic, xAI and/or OpenCode. Demo bots need no keys.

## Install and run

```bash
npm install          # from the repo root (npm workspaces: engine + app)
npm run dev          # http://localhost:5173  (the proxy is mounted at /proxy automatically)
```

Production build:

```bash
npm run build        # type-check + vite build -> app/dist
npm run preview      # http://localhost:4173  (also mounts the proxy at /proxy)
```

Stand-alone proxy (only needed if you host `app/dist` with some other static server):

```bash
npm run proxy        # http://localhost:8787/proxy  (PORT=xxxx to change)
```

Then set "Proxy address" in the key panel to `http://localhost:8787/proxy`.

### What the proxy does

`app/proxy/proxy.mjs` is a small stateless pass-through that exists because some provider endpoints
do not allow browser (CORS) calls. It:

- forwards only to an allow-list: `opencode.ai` (`/inference/*`, `/zen/*`), `api.openai.com/v1/*`,
  `api.anthropic.com/v1/*`, `api.x.ai/v1/*`
- forwards only these request headers: `authorization`, `x-api-key`, `content-type`, `accept`,
  `anthropic-version`, `x-opencode-session`, and sets `User-Agent: llm-boxing-arena/0.1`
- answers CORS for localhost origins only, binds to 127.0.0.1, caps bodies at 1 MB
- stores nothing and logs at most `METHOD /route/path -> status` (no query strings, headers or bodies)

There is a test that sends a secret through it and checks the secret never appears in the log.

## API keys

- Keys live only in React state. They are never written to localStorage, sessionStorage, cookies or
  IndexedDB, never logged and never put in a URL. Reloading the page clears them.
  (`app/test/keys.test.tsx` checks this: it spies on the storage APIs while keys are typed and used.)
- Saved fight logs never contain keys.
- Calls go straight from your browser to the provider when the provider allows it:
  - **Anthropic**: direct, with the `anthropic-dangerous-direct-browser-access: true` header.
  - **xAI**: direct.
  - **OpenAI**: direct works for success responses, but OpenAI's error responses carry no CORS header,
    so the browser can't read them (you'd just see "Failed to fetch"). Tick "Send via local proxy" to get
    readable errors.
  - **OpenCode**: always through the local proxy (its chat endpoints reject browser preflights).
- Model calls run one at a time, for every provider. Boxer A is asked, and the fight waits for the full
  reply or for that call to time out, before boxer B is asked. The same order is used for the build
  (the boxer pick), every corner tactic, and every exchange. Judges and commentary do not call a model.
- Every LLM call has a 120 second timeout (`LLM_CALL_TIMEOUT_MS`). If a call fails, times out, or
  comes back unusable, the in-flight request is aborted and the match stops immediately. No further
  model calls are made, no fallback move is substituted, and no winner, scorecard or fight log is saved.
  The setup screen shows which corner failed (provider and model id), at which step (boxer pick, a
  round's corner tactic, or a round and exchange action), and why. Pick the models again and start a
  new match. Keys stay in page memory only.

## OpenCode: Console vs Go

- **Console (pay as you go)**: models come live from `https://opencode.ai/zen/v1/models`.
- **Go (subscription)**: models come live from `https://opencode.ai/inference/go/v1/models`.
  The app shows a warning: *Use at your own risk: OpenCode says Go is meant for coding-agent traffic,
  and they monitor for misuse.*

Only chat models are listed, grouped by family, with context size and a rough cost-per-fight estimate
(about 71 calls of ~1,100 input + ~250 output tokens; treat it as a ballpark). Each model is called in the
API style OpenCode lists for it (chat-completions, responses, messages or generate-content). Every OpenCode
call sends `x-opencode-client: llm-boxing-arena/0.1` and an `x-opencode-session` id that is unique per
fighter per fight. Direct providers load their own model lists with your key and fall back to a built-in list
if that fails (you can also type a custom model id).

## Demo

Pick "Demo bot" in either corner (out-boxer, swarmer or slugger), set a seed and press **Fight!**.
Same seed and same answers always give the same fight. Seed 11 with red slugger vs blue swarmer ends in a
round-10 stoppage after a knockdown, handy for seeing the knockdown, count, replay and hand raise.

Playback controls: play/pause (space bar), 1x / 2x / 4x, skip to result, knockdown replays on/off,
cameras (auto / wide / ringside / shoulder; auto also cuts to corner and replay shots), a low-quality
toggle (fewer crowd stands, no shadows, lower pixel ratio), and sound: a mute button, a volume slider
and a spoken-commentary toggle. Sound stays off until you turn it on, so the browser is allowed to play it.

## Fight logs and replay

Download a fight log (JSON) from the controls or the result card. Upload one on the setup screen and the
app re-runs it through the engine's `replayFight`, tells you whether the result is identical to the file,
then plays it back. Logs contain builds, every plan, every event and the result, but no keys.

## Tests

```bash
npm test             # engine tests, then app tests (vitest)
npm run typecheck    # tsc --noEmit for engine and app
npm run build
```

App tests cover JSON extraction from messy model replies, model-list parsing (with trimmed real OpenCode
fixtures), request building for all four API styles, the playback timeline (matches the engine's final
state; replay identical), keys never persisted, and the proxy (allow-list, header filtering, never logs
secrets, stand-alone server).

End-to-end proof (needs a build first and network access to opencode.ai for the live model list):

```bash
cd e2e && npm install && npx playwright install chromium-headless-shell
node run-e2e.mjs     # writes screenshots, a ~20-40 s video, a fight log and e2e-report.json to ../proof/
```

It starts `vite preview`, checks the OpenCode Console and Go lists load in the picker, starts a fight with a
fake OpenCode key and checks the UI shows OpenCode's 401 as a readable error (and that the key never reaches
the server log), plays seed 11 demo vs demo at 4x to the result (round 1, knockdown, replay, scorecard),
downloads and re-uploads the log, and toggles low quality.

## Assets and credits (all CC0)

| File (app/public/…) | Source | Licence |
|---|---|---|
| `assets/boxer.glb`, `assets/referee.glb` | Quaternius, *Ultimate Animated Character Pack* (Nov 2019): `BaseCharacter.fbx`, `Casual_Male.fbx`, https://opengameart.org/content/animated-characters-pack | CC0 1.0 |
| `assets/ring.glb` | tevy.dev *Boxing Ring v1*, https://tevy.dev/models/boxing-ring | CC0 1.0 |
| `assets/stool.glb` | tevy.dev *Boxing Corner Stool v1*, https://tevy.dev/models/boxing-corner-stool | CC0 1.0 |
| `assets/crowd.glb` | tevy.dev *Grandstand Crowd v1*, https://tevy.dev/models/grandstand-crowd | CC0 1.0 |
| `basis/basis_transcoder.*` | copied from three.js (`examples/jsm/libs/basis`), needed to decode the KTX2 textures | Apache-2.0 |

Sound effects (punches, bell, count, crowd) are CC0 too. Sources and licences are in `app/public/assets/CREDITS.md`.

Credit is not required by CC0, but thanks to Quaternius, tevy.dev, Kenney and the OpenGameArt authors. No Mixamo, Rokoko, Unity Asset Store
or Quaternius-QAL files are used, nothing was bought and no accounts were made.

The Quaternius FBX files were converted to GLB by loading them with three.js `FBXLoader`, scaling by 0.01 and
exporting with `GLTFExporter` (then `gltf-transform resample/dedup/prune`). The skinned mesh node was renamed
`BodyMesh` so it doesn't clash with the `Body` bone. Boxer gloves, cuffs, trunks and boots are procedural
meshes attached to the bones and tinted per corner; body width comes from the boxer's stats.

Animation: the pack's clips (Idle, Walk, RecieveHit, SitDown, StandUp, Victory, Defeat) are sampled at
explicit times so a frame is a pure function of fight time. Everything the pack lacks is animated in code:
guard, punches (two-bone IK, curved paths for hooks and uppercuts), slips, blocks, clinches, head snaps,
the knockdown fall (sit clip plus a backward tip around the hips), the referee's break, count, wave-off and
the winner's raised hand.

## Known limits

- There is no CC0 fall/knockdown clip in the pack, so the knockdown is procedural and a bit stiff.
- OpenAI direct calls can't show error details in the browser (CORS on errors); use the proxy tickbox.
- OpenCode Go is meant for coding-agent traffic; using it here is at your own risk.
- Cost per fight is an estimate from list prices, not a quote.
- The Quaternius *Universal Animation Library* (also CC0) was not used: its itch.io download needs an
  interactive flow, so only the 2019 Ultimate pack is shipped.
- Models are the same base character recoloured, so boxers differ by colour and build, not face.
- Long LLM fights take a while to simulate (about 71 calls per fighter, one call at a time); the thinking screen shows progress.
- The 3D view is built for desktop; it runs on mobile but the HUD is cramped.
