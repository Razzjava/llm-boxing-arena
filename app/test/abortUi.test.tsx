import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App";
import { fightHistory, resetArenaRecord } from "../src/fight/record";

const SECRET = "sk-test-ui-secret-value";

const MODELS = {
  data: ["red-fighter", "blue-fighter"].map((id) => ({
    id,
    name: id === "red-fighter" ? "Red Fighter" : "Blue Fighter",
    type: "chat",
    family: "test",
    modalities: { output: ["text"] },
    recommended_api: "chat-completions",
    api: { "chat-completions": { base_url: "https://opencode.ai/inference/openai/v1" } },
  })),
};

const BUILD = JSON.stringify({
  name: "Ada Stone",
  nickname: "Ace",
  stance: "orthodox",
  style: "slugger",
  stats: { power: 5, speed: 5, accuracy: 5, defence: 5, chin: 5, stamina: 5 },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function chat(text: string, status = 200): Response {
  if (status !== 200) return json({ error: { message: text } }, status);
  return json({ choices: [{ message: { content: text } }] });
}

afterEach(() => {
  cleanup();
  resetArenaRecord();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function chooseOpenCode(corner: "red" | "blue", modelId: string) {
  fireEvent.change(screen.getByTestId(`source-${corner}`), { target: { value: "opencode" } });
  await waitFor(() => expect(screen.getByTestId(`picker-${corner}-source`).textContent).toMatch(/live/));
  fireEvent.click(screen.getByTestId(`picker-${corner}-toggle`));
  const option = await waitFor(() => {
    const found = screen.getAllByTestId("model-option").find((el) => el.getAttribute("data-model-id") === modelId);
    if (!found) throw new Error(`missing ${modelId}`);
    return found;
  });
  fireEvent.click(option);
}

function expectBackOnSetup() {
  expect(screen.getByTestId("start-fight")).toBeTruthy();
  expect(screen.queryByTestId("watch")).toBeNull();
  expect(screen.queryByTestId("sim-status")).toBeNull();
  expect(screen.queryByTestId("result-card")).toBeNull();
  expect(screen.queryByTestId("download-log")).toBeNull();
  expect(screen.queryByTestId("download-log-result")).toBeNull();
  expect(fightHistory()).toEqual([]);
}

describe("a failed model call returns to setup", () => {
  it("shows which OpenCode model failed the boxer pick and keeps the previous choices", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/models")) return json(MODELS);
      posts.push(String(init?.body ?? ""));
      return chat(`bad key ${SECRET}`, 401);
    }));

    render(<App />);
    fireEvent.change(screen.getByTestId("key-opencode"), { target: { value: SECRET } });
    await chooseOpenCode("red", "red-fighter");
    const seed = (screen.getByTestId("seed") as HTMLInputElement).value;
    fireEvent.click(screen.getByTestId("start-fight"));

    const alert = await screen.findByTestId("fight-error");
    expect(alert.textContent).toMatch(/Red corner \(OpenCode, red-fighter\) failed at boxer pick: OpenCode 401:/);
    expect(alert.textContent).not.toContain(SECRET);
    expect(alert.textContent).not.toMatch(/authorization|bearer/i);
    expectBackOnSetup();
    expect((screen.getByTestId("source-red") as HTMLSelectElement).value).toBe("opencode");
    expect((screen.getByTestId("source-blue") as HTMLSelectElement).value).toBe("demo");
    expect((screen.getByTestId("key-opencode") as HTMLInputElement).value).toBe(SECRET);
    expect((screen.getByTestId("seed") as HTMLInputElement).value).toBe(seed);
    expect(screen.getByTestId("picker-red-toggle").textContent).toMatch(/Red Fighter/);
    expect(posts).toHaveLength(1);
  });

  it("names the exchange when OpenCode returns an unusable action and stops there", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/models")) return json(MODELS);
      calls += 1;
      if (calls === 1) return chat(BUILD);
      if (calls === 2) return chat(JSON.stringify({ tactic: "pressure", talk: "go" }));
      return chat("I will kick");
    }));

    render(<App />);
    fireEvent.change(screen.getByTestId("key-opencode"), { target: { value: SECRET } });
    await chooseOpenCode("red", "red-fighter");
    fireEvent.click(screen.getByTestId("start-fight"));

    const alert = await screen.findByTestId("fight-error");
    expect(alert.textContent).toBe("Red corner (OpenCode, red-fighter) failed at round 1, exchange 1 action: unusable response: no JSON in reply");
    expectBackOnSetup();
    expect((screen.getByTestId("source-red") as HTMLSelectElement).value).toBe("opencode");
    expect(calls).toBe(3);
  });

  it("names the blue OpenCode model when its pick fails and does not ask again", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/models")) return json(MODELS);
      calls += 1;
      const body = String(init?.body ?? "");
      if (body.includes("RED corner")) return chat(BUILD);
      return chat("overloaded", 500);
    }));

    render(<App />);
    fireEvent.change(screen.getByTestId("key-opencode"), { target: { value: SECRET } });
    await chooseOpenCode("red", "red-fighter");
    await chooseOpenCode("blue", "blue-fighter");
    fireEvent.click(screen.getByTestId("start-fight"));

    const alert = await screen.findByTestId("fight-error");
    expect(alert.textContent).toBe("Blue corner (OpenCode, blue-fighter) failed at boxer pick: OpenCode 500: overloaded");
    expect(alert.textContent).not.toContain(SECRET);
    expectBackOnSetup();
    expect((screen.getByTestId("source-blue") as HTMLSelectElement).value).toBe("opencode");
    expect(screen.getByTestId("picker-blue-toggle").textContent).toMatch(/Blue Fighter/);
    expect(calls).toBe(2);
  });
});
