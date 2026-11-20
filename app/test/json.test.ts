import { describe, expect, it } from "vitest";
import { extractJson } from "../src/providers/json";

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"actions":["jab","cross"],"talk":"hi"}')).toEqual({ actions: ["jab", "cross"], talk: "hi" });
  });
  it("finds JSON inside a fenced block with prose around it", () => {
    const text = 'Sure! Here is my plan:\n```json\n{"tactic": "pressure", "talk": "Go"}\n```\nGood luck.';
    expect(extractJson(text)).toEqual({ tactic: "pressure", talk: "Go" });
  });
  it("ignores <think> blocks and braces inside strings", () => {
    const text = '<think>maybe {"actions":["move"]}?</think> I will go {"actions":["hook","body"],"talk":"a } brace"}';
    expect(extractJson(text)).toEqual({ actions: ["hook", "body"], talk: "a } brace" });
  });
  it("repairs trailing commas", () => {
    expect(extractJson('{"actions":["jab","slip",],}')).toEqual({ actions: ["jab", "slip"] });
  });
  it("prefers the object with the expected key", () => {
    const text = 'Scratch: {"note":1} final {"stats":{"power":5}} then {"other":2}';
    expect(extractJson(text, ["stats"])).toEqual({ stats: { power: 5 } });
  });
  it("returns null for junk, arrays and non-strings", () => {
    expect(extractJson("I refuse to box.")).toBeNull();
    expect(extractJson("[1,2,3]")).toBeNull();
    expect(extractJson(undefined)).toBeNull();
    expect(extractJson('{"broken": ')).toBeNull();
  });
});
