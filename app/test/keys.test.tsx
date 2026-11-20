// Keys must live only in React state: no Web Storage, cookies or IndexedDB, never in the URL, never logged.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/App";

const SECRET = "sk-test-NEVER-STORE-ME-1234567890";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx|mjs)$/.test(f) ? [p] : [];
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("API keys", () => {
  it("are never written to storage, cookies, IndexedDB, the URL or the console", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookieSet = vi.fn();
    const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: cookieSet });
    const idbOpen = vi.fn();
    vi.stubGlobal("indexedDB", { open: idbOpen });
    const logged: string[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a) => void logged.push(a.map(String).join(" ")));
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ object: "list", data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    render(<App />);
    for (const id of ["openai", "anthropic", "xai", "opencode"]) {
      fireEvent.change(screen.getByTestId(`key-${id}`), { target: { value: SECRET } });
    }
    // Using a provider triggers model-list fetches with the key.
    await act(async () => {
      fireEvent.change(screen.getByTestId("source-red"), { target: { value: "opencode" } });
      fireEvent.change(screen.getByTestId("source-blue"), { target: { value: "openai" } });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(cookieSet).not.toHaveBeenCalled();
    expect(idbOpen).not.toHaveBeenCalled();
    expect(location.href).not.toContain(SECRET);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).not.toContain(SECRET);
    for (const l of logged) expect(l).not.toContain(SECRET);

    // Reload = fresh state: a new App starts with empty keys.
    cleanup();
    render(<App />);
    expect((screen.getByTestId("key-openai") as HTMLInputElement).value).toBe("");

    if (cookieDesc) delete (document as unknown as Record<string, unknown>).cookie;
    vi.unstubAllGlobals();
  });

  it("app source never touches browser storage except audio preferences", () => {
    const files = sourceFiles(join(__dirname, "../src"));
    const read = (f: string) => readFileSync(f, "utf8");
    const call = /\b(localStorage|sessionStorage|indexedDB)\s*[.[]|document\.cookie|caches\.open/;
    expect(files.filter((f) => call.test(read(f)))).toEqual([]);
    const mentions = files.filter((f) => /\bwindow\.localStorage\b/.test(read(f)));
    expect(mentions.map((f) => f.split("src/").pop())).toEqual(["audio/prefs.ts"]);
    const src = read(mentions[0] as string);
    expect(src).toContain('AUDIO_STORAGE_KEY = "arena-audio"');
    expect(src).not.toMatch(/sk-/);
  });
});
