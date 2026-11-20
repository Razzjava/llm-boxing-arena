# LLM Boxing Arena: concept and MVP plan (draft v1, 19 Nov 2026)

## What it is
A web page where a viewer picks two LLMs (say GPT vs Claude), pastes their own API keys, and watches the two models box a 12-round fight. Each model builds its boxer, then chooses its actions every exchange. A deterministic engine resolves the punches, three judges score it, and commentary plus simple animation tell the story.

## 1. Picking a boxer
Each model gets the same prompt: "Build your fighter with 30 points across 6 stats (each 1-10)."
- Power: damage per landed punch
- Speed: who lands first in an exchange, harder to counter
- Accuracy: chance to land
- Defence: chance to block/slip, damage reduced when blocking
- Chin: how much damage before a knockdown
- Stamina: size of the energy tank and recovery between rounds
Plus a name, nickname, stance (orthodox/southpaw) and a style tag (out-boxer, swarmer, slugger, counter-puncher) which nudges the commentary and gives small bonuses (e.g. counter-puncher +10% on counters).
The 30-point cap forces trade-offs, so there's no "all 10s" boxer.

## 2. How a round works
- 12 rounds, each 3 minutes, split into 6 exchanges of 30 seconds.
- Each exchange, both models get the same fight state as JSON (round, clock, both boxers' health, stamina, cuts, knockdowns this round, last exchange's result, and the judges are hidden) and reply with a short plan: 1-3 actions from jab, cross, hook, uppercut, body shot, block, slip, clinch, move, plus an optional one-line "corner talk".
- Both answers are collected first, then resolved together, so neither sees the other's move.
- Between rounds, each model gets a "corner" turn: a short summary of the round and a choice of tactic for the next one (pressure, box, survive).
- Bad or late answers: if a model returns junk or times out, its boxer defaults to "block + move" for that exchange. A fight can't stall.

## 3. The engine (pure TypeScript, seeded)
Pure function: `resolveExchange(state, actionsA, actionsB, rng) -> newState + events`. Same seed and same model answers always give the same fight, so any fight can be replayed from its log.
- Each punch has a stamina cost, base damage, and land chance (jab cheap and accurate, uppercut costly and risky, body shots drain the other side's stamina instead of head health).
- Slip beats straight punches (jab, cross) and sets up a counter; block reduces damage but costs a little stamina; clinch stops the exchange but the referee breaks it and repeated clinching loses points; move reduces the other side's land chance but scores nothing.
- Low stamina cuts speed, power and defence, so gassing out matters.
- Cuts: hooks and heads clashing can open a cut; cuts bleed into later rounds and raise TKO risk.
- Knockdown: a big shot when head damage passes a threshold set by Chin. Standing up takes a stamina-and-chin roll for a 10 count.
- Endings: KO (doesn't beat the count), TKO (3 knockdowns in a round, or referee/doctor stops it for a bad cut or one-sided beating), or goes the distance to the judges.

## 4. Judging
Three judges score every round 10-9 to whoever landed more and cleaner, 10-8 with a knockdown or a dominant round, 10-7 for two knockdowns. Each judge has a small built-in bias (one likes aggression, one likes clean punching, one likes defence), so split decisions can happen. Results: UD, SD, MD or draw. Point deductions for repeated clinching.

## 5. Commentary and visuals
- Commentary: template lines generated from the engine's events ("Huge right hand! He's down!"), with no extra AI call, so it's free and instant. Corner-talk lines from the models get shown as quotes. An optional "AI commentator" can come later.
- Visuals: a simple 2D ring (SVG/CSS), two boxer figures with a few poses (idle, punch, block, hit, down), health and stamina bars, round clock, scorecards revealed at the end. Playback paced so a full fight takes ~5-8 minutes to watch, with a skip button.

## 6. API keys
- Viewer pastes their keys into the page. They live only in browser memory for that tab. Not saved to local storage, not logged, not sent to any server of ours, never in the repo.
- Calls go straight from the browser to the provider. OpenAI, Anthropic (with its browser-access header) and xAI allow this. If a provider blocks browser calls, a tiny stateless pass-through proxy forwards the request and stores nothing.
- A "demo mode" with two scripted bots so people can watch a fight without any keys (also used for tests).

## MVP scope (first build)
In:
- Pick 2 models from OpenAI, Anthropic, xAI; paste keys; start fight
- Boxer creation, 12 rounds x 6 exchanges, full engine with stamina, damage, cuts, knockdowns, KO/TKO, 3-judge scoring
- Template commentary, simple 2D animated ring, final scorecard
- Demo mode with scripted bots, and replay from a saved fight log (download/upload JSON)
Out for now: accounts, leaderboards, betting, AI commentator voice, tournaments, sharing links, paid hosting.

## Stack
- React + TypeScript with Vite (fast, simple, no server needed)
- Engine as a separate pure TypeScript module with Vitest tests
- Hosting: none paid. Runs locally / free static preview only, until Mohammed says otherwise.
- Built by a cloud coding agent in a new GitHub repo; every build ships with engine tests passing plus a real end-to-end fight (demo mode, and one real-model fight if keys are available to the tester) with screenshots or a short clip.

## Questions for Mohammed
1. OK to go ahead with this MVP and stack?
2. Which GitHub account/org should the repo live in, and public or private?
3. Any providers beyond OpenAI, Anthropic and xAI for v1 (e.g. Google Gemini)?

---
## Revision v2 (19 Nov 2026): OpenCode added
Mohammed's answers: add OpenCode as a fourth key option, keep OpenAI, Anthropic, xAI as direct providers, no Gemini direct, repo public.

### What I found (checked live, 19 Nov 2026)
- Two OpenCode products, one key style: Console pay-as-you-go (~90 models incl. GPT, Claude, Gemini, Grok, Kimi, GLM, DeepSeek, Qwen, plus some free ones) and Go subscription ($10/$40 a month, open models only: Kimi, GLM, DeepSeek, MiniMax, Qwen etc.).
- Model lists are public, no key needed, and the browser can read them: https://opencode.ai/zen/v1/models (Console) and https://opencode.ai/inference/go/v1/models (Go). Each entry has name, family, context size, price and which API style to call.
- Every text model can be called through one OpenAI-style chat endpoint (OpenCode translates), so the arena needs one client for all of them.
- Browser calls to the actual chat endpoints are blocked (no CORS on /inference/*, preflight returns 404). So OpenCode needs the stateless pass-through proxy. It forwards the request with the viewer's key and stores/logs nothing.
- Caveat on Go: OpenCode's docs say Go is designed for coding-agent traffic, they monitor for abuse, and ask clients to send their own user agent and a session id header. A boxing game isn't coding traffic, so heavy use on a Go key could get flagged. Console pay-as-you-go keys have no such rule. Plan: support both, label Go "use at your own risk", send a proper user agent (llm-boxing-arena/0.1) and one session id per fighter.

### Changes to the plan
1. Key panel: OpenAI, Anthropic, xAI, and OpenCode (with a Console / Go switch).
2. Model picker per corner: pick a provider you've entered a key for, then a searchable dropdown of that provider's models, grouped by family, showing context size and price per fight estimate. For OpenCode the list loads live from the endpoint above, chat models only. Each corner can mix sources (e.g. GPT direct vs Kimi via OpenCode).
3. Proxy: one tiny stateless function (Cloudflare Worker free tier or Vite dev proxy locally) that forwards only to opencode.ai/inference/*. No storage, no logging of bodies or headers. Direct providers still go browser-to-provider. For MVP it runs locally only; any hosting needs Mohammed's yes.
4. Tests add: model-list parsing, proxy forwards without logging, one real fight via OpenCode if a tester key is available (I never handle real keys in chat).

Repo: public GitHub repo, account still needed.

---
## Revision v3 (19 Nov 2026): realistic 3D fight visuals
Mohammed wants it to look like a real boxing match, not a 2D ring. This replaces section 5's "simple 2D ring".

### Key idea (all options)
The engine already outputs a timed event log (who threw what, landed/blocked/slipped, damage, knockdown). The 3D scene only plays that log back. So visuals never change the fight result, replays come free (re-play the log from any camera, at any speed), and the visual layer can be upgraded later without touching the engine or tests.

### Options
| | A. Stylised 3D | B. Broadcast-real 3D | C. Game-engine quality |
|---|---|---|---|
| Look | Clean 3D ring, two rigged boxers with real motion-captured moves, lit like an arena | Realistic bodies, sweat/swelling/cut decals, ref, corner teams, packed crowd, TV-style camera cuts, slow-mo replays | Close to a console boxing game |
| Tech | Three.js via React Three Fiber in the browser | Same, plus physics (Rapier) for ragdoll knockdowns, animation blending, sound | Unreal/Unity, streamed or as a heavy WebGL build |
| Assets | Free rigged characters + ~15 mocap clips (jab, cross, hook, uppercut, body, block, slip, clinch, footwork, hit reactions, knockdown, get-up, celebrate) | More clips, custom textures, crowd/ref models | Paid assets or custom mocap |
| Effort | ~1-2 weeks of agent build | ~3-5 more weeks on top of A | Months; paid tools/hosting likely |
| Cost | £0 | £0 with free assets (paid assets optional, need a yes) | Real money; not recommended |
| Runs on | Any modern laptop/phone browser | Decent laptop; phone with a "low quality" switch | Strong GPU or paid streaming |

### Recommendation
MVP = A, built so it grows into B:
- 3D ring, ropes, canvas, arena lighting
- Two rigged boxers, colour/trunks from each LLM's chosen boxer, size from stats
- Mocap clips for every action, blended so punches flow into blocks and slips
- Hit reactions: head snap/body fold scaled by damage, stagger when hurt, knockdown fall and get-up or count-out
- Referee with basic moves (break clinch, count, wave off for TKO)
- Three cameras: wide broadcast, ringside, over-the-shoulder; auto-cuts on big moments
- Instant slow-mo replay of every knockdown
- Crowd as cheap low-detail figures, plus HUD (health, stamina, clock, round)
Later (B): ragdoll physics for knockdowns, visible swelling/cuts/sweat, corner teams between rounds, crowd noise and commentary audio, replay of any moment from any angle, higher-detail bodies.

### Open checks before build
- Asset licences: the repo is public, so models and animations must be allowed in a public repo. Free CC0 asset packs are the safe choice. Mixamo (Adobe's free mocap library) has the best boxing clips, but its terms may not allow raw files in a public repo, and downloading needs an Adobe login. I'll confirm the licence before using any of it, and won't sign into anything without a yes.
- Realism is capped by free assets: it'll look like a decent indie game, not EA's Fight Night, at £0.
