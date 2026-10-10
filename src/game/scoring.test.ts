import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@/core/adapters/memoryStore";
import {
  CURRENT_SCORING_VERSION,
  MAX_SCORES,
  addScore,
  clearScores,
  loadName,
  loadScores,
  migrateScores,
  parseScores,
  sanitizeName,
  saveName,
  saveScores,
  updateName,
  type ScoreEntry,
} from "./scoring";

function entry(overrides: Partial<ScoreEntry> = {}): ScoreEntry {
  return {
    id: "run-1",
    name: "ABC",
    score: 100,
    level: 3,
    chips: 21,
    maxCombo: 8,
    date: 1_700_000_000_000,
    scoringVersion: CURRENT_SCORING_VERSION,
    ...overrides,
  };
}

describe("sanitizeName", () => {
  it("uppercases and strips non-alphanumerics", () => {
    expect(sanitizeName("ab")).toBe("AB");
    expect(sanitizeName("a-b!c")).toBe("ABC");
    expect(sanitizeName("xyz")).toBe("XYZ");
  });

  it("caps at three characters", () => {
    expect(sanitizeName("abcdefgh")).toBe("ABC");
  });

  it("rejects injection payloads entirely", () => {
    expect(sanitizeName("<script>alert(1)</script>")).toBe("SCR");
    expect(sanitizeName("&#39; DROP TABLE")).toBe("39D");
    expect(sanitizeName("../../etc/passwd")).toBe("ETC");
    expect(sanitizeName("")).toBe("");
  });
});

describe("parseScores", () => {
  it("drops malformed entries instead of throwing", () => {
    const parsed = parseScores([
      entry(),
      { id: "bad", score: "not-a-number" },
      null,
      "nope",
      entry({ id: "good", score: 5 }),
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((e) => e.id)).toEqual(["run-1", "good"]);
  });

  it("returns [] for non-arrays", () => {
    expect(parseScores(null)).toEqual([]);
    expect(parseScores({})).toEqual([]);
    expect(parseScores("[]")).toEqual([]);
  });

  it("rejects negative and non-integer scores", () => {
    expect(parseScores([entry({ score: -1 })])).toEqual([]);
    expect(parseScores([entry({ score: 1.5 })])).toEqual([]);
  });

  it("de-duplicates ids", () => {
    expect(parseScores([entry(), entry()])).toHaveLength(1);
  });

  it("defaults a missing scoringVersion to 1 (legacy)", () => {
    const raw = [{ ...entry(), scoringVersion: undefined }];
    expect(parseScores(raw)[0].scoringVersion).toBe(1);
  });

  it("caps the list at MAX_SCORES", () => {
    const many = Array.from({ length: MAX_SCORES + 5 }, (_, i) => entry({ id: `r${i}`, score: i }));
    expect(parseScores(many)).toHaveLength(MAX_SCORES);
  });
});

describe("addScore", () => {
  it("inserts in descending score order and reports the rank", () => {
    const store = createMemoryStore();
    saveScores([entry({ id: "a", score: 500 }), entry({ id: "b", score: 300 })], store);
    const { list, rank } = addScore(entry({ id: "new", score: 400 }), store);
    expect(list.map((e) => e.id)).toEqual(["a", "new", "b"]);
    expect(rank).toBe(2);
  });

  it("returns rank -1 when the entry does not make the table", () => {
    const store = createMemoryStore();
    saveScores(
      Array.from({ length: MAX_SCORES }, (_, i) => entry({ id: `r${i}`, score: 1000 + i })),
      store,
    );
    const { rank, list } = addScore(entry({ id: "low", score: 1 }), store);
    expect(rank).toBe(-1);
    expect(list).toHaveLength(MAX_SCORES);
    expect(list.some((e) => e.id === "low")).toBe(false);
  });

  it("breaks ties on date, earliest first", () => {
    const store = createMemoryStore();
    const { list } = addScore(entry({ id: "earlier", score: 100, date: 1 }), store);
    addScore(entry({ id: "later", score: 100, date: 2 }), store);
    expect(loadScores(store)[0].id).toBe("earlier");
    expect(list).toBeDefined();
  });

  it("persists to the injected store", () => {
    const store = createMemoryStore();
    addScore(entry({ id: "x" }), store);
    expect(store.get("gridbox-intelligence.scores.v1")).toContain('"id":"x"');
  });
});

describe("updateName", () => {
  it("renames only the targeted entry and sanitises the value", () => {
    const store = createMemoryStore();
    saveScores([entry({ id: "a" }), entry({ id: "b" })], store);
    const list = updateName("a", "z-9!", store);
    expect(list.find((e) => e.id === "a")?.name).toBe("Z9");
    expect(list.find((e) => e.id === "b")?.name).toBe("ABC");
  });

  it("falls back to YOU rather than writing an empty name", () => {
    const store = createMemoryStore();
    saveScores([entry({ id: "a" })], store);
    expect(updateName("a", "", store)[0].name).toBe("YOU");
  });
});

describe("loadName / saveName", () => {
  it("defaults to YOU", () => {
    expect(loadName(createMemoryStore())).toBe("YOU");
  });

  it("round-trips a sanitised three-character name", () => {
    const store = createMemoryStore();
    saveName("basgenix", store);
    expect(loadName(store)).toBe("BAS");
  });
});

describe("clearScores", () => {
  it("empties the table", () => {
    const store = createMemoryStore();
    saveScores([entry()], store);
    expect(clearScores(store)).toEqual([]);
    expect(loadScores(store)).toEqual([]);
  });
});

describe("migrateScores", () => {
  it("tags untagged entries as version 1 and leaves tagged ones alone", () => {
    // An entry written by a pre-versioning build: no scoringVersion field at all.
    const legacy = {
      id: "old",
      name: "ABC",
      score: 100,
      level: 3,
      chips: 21,
      maxCombo: 8,
      date: 1,
    } as unknown as ScoreEntry;
    const out = migrateScores([legacy, entry({ id: "new" })]);
    expect(out.find((e) => e.id === "old")?.scoringVersion).toBe(1);
    expect(out.find((e) => e.id === "new")?.scoringVersion).toBe(CURRENT_SCORING_VERSION);
  });
});

describe("corrupt storage resilience", () => {
  it("survives invalid JSON", () => {
    const store = createMemoryStore({ "gridbox-intelligence.scores.v1": "{not json" });
    expect(loadScores(store)).toEqual([]);
  });

  it("survives JSON that is not an array", () => {
    const store = createMemoryStore({ "gridbox-intelligence.scores.v1": '{"a":1}' });
    expect(loadScores(store)).toEqual([]);
  });
});
