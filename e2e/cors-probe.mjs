// CORS probe: from a localhost page, which provider endpoints can the browser read? Uses fake keys only.
// Needs `npm run dev` running on :5173. Usage: node cors-probe.mjs
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('http://localhost:5173/');
const res = await p.evaluate(async () => {
  const fake = 'sk-fake-not-a-real-key';
  const tests = [
    ['openai models', 'https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + fake } }],
    ['openai chat', 'https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + fake, 'content-type': 'application/json' }, body: '{}' }],
    ['anthropic models', 'https://api.anthropic.com/v1/models', { headers: { 'x-api-key': fake, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }],
    ['anthropic messages', 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': fake, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' }, body: '{}' }],
    ['xai models', 'https://api.x.ai/v1/models', { headers: { Authorization: 'Bearer ' + fake } }],
    ['xai chat', 'https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + fake, 'content-type': 'application/json' }, body: '{}' }],
    ['opencode zen models', 'https://opencode.ai/zen/v1/models', {}],
    ['opencode go models', 'https://opencode.ai/inference/go/v1/models', {}],
    ['opencode chat direct', 'https://opencode.ai/inference/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + fake, 'content-type': 'application/json' }, body: '{}' }],
  ];
  const out = [];
  for (const [name, url, init] of tests) {
    try { const r = await fetch(url, init); out.push(`${name}: HTTP ${r.status} (readable by page)`); }
    catch (e) { out.push(`${name}: BLOCKED (${e.message})`); }
  }
  return out;
});
console.log(res.join('\n')); await b.close();
