import { describe, expect, it } from "vitest";
import { checkDisplayName, checkInitials, containsProfanity, normalizeName, toInitials } from "./names.js";

describe("normalizeName", () => {
  it("folds case, leet and punctuation to a comparable stem", () => {
    expect(normalizeName("Nova")).toBe("nova");
    expect(normalizeName("F.U.C.K")).toBe("f u c k");
    expect(normalizeName("fûck")).toBe("fuck");
    expect(normalizeName("f u c k")).toBe("f u c k");
    expect(normalizeName("Sh1t-H34d")).toBe("shit head");
    expect(normalizeName("  a$$hole  ")).toBe("asshole");
    expect(normalizeName("Grìd-Box")).toBe("grid box");
    // ø does not decompose under NFKD — it becomes a separator, not an o.
    expect(normalizeName("Bøx")).toBe("b x");
  });

  it("leaves clean names untouched", () => {
    // digits leet-fold in the comparison stem (4→a, 2→z); the stored
    // value is untouched — only the matching stem folds.
    expect(normalizeName("Player 42")).toBe("player az");
    expect(normalizeName("")).toBe("");
  });
});

describe("containsProfanity", () => {
  // containsProfanity takes an already-normalised stem; normaliseName is the
  // step that leet-decodes and folds, so the pair is what call sites use.
  it("catches the blocklist, its leet and its diacritic spellings", () => {
    expect(containsProfanity("fuck")).toBe(true);
    expect(containsProfanity("f u c k")).toBe(true);
    expect(containsProfanity("what the fuck")).toBe(true);
    expect(containsProfanity("bitch")).toBe(true);
    expect(containsProfanity(normalizeName("a55h0le"))).toBe(true);
  });

  it("does not trip on innocent substrings", () => {
    expect(containsProfanity("scunthorpe")).toBe(false);
    expect(containsProfanity("assassin")).toBe(false);
    expect(containsProfanity("shitake")).toBe(false);
    expect(containsProfanity("dickens")).toBe(false);
    expect(containsProfanity("grass")).toBe(false);
    expect(containsProfanity("")).toBe(false);
  });
});

describe("checkDisplayName", () => {
  it("accepts clean names and trims them", () => {
    expect(checkDisplayName("  Nova  ")).toEqual({ ok: true, value: "Nova" });
    expect(checkDisplayName("Grid-Box")).toEqual({ ok: true, value: "Grid-Box" });
  });

  it("rejects the wordlist and its disguises", () => {
    expect(checkDisplayName("fuck").ok).toBe(false);
    expect(checkDisplayName("F.U.C.K").ok).toBe(false);
    expect(checkDisplayName("f u c k").ok).toBe(false);
    expect(checkDisplayName("bitch").ok).toBe(false);
  });

  it("leaves partial-space evasions to the report queue, not the auto-filter", () => {
    // Catching "fu ck" needs raw substring matching, which also flags
    // "Scunthorpe". The locked design prefers the false negative: the report
    // endpoint and the moderation queue exist exactly for this family.
    expect(checkDisplayName("fu ck").ok).toBe(true);
    expect(checkDisplayName("Scunthorpe").ok).toBe(true);
  });

  it("keeps the classic false-positive family playable", () => {
    expect(checkDisplayName("Scunthorpe").ok).toBe(true);
    expect(checkDisplayName("Assassin").ok).toBe(true);
  });
});

describe("toInitials", () => {
  it("takes up to three letters and pads short names", () => {
    expect(toInitials("Nova")).toBe("NOV");
    expect(toInitials("Bo")).toBe("BOX");
    expect(toInitials("Player 42")).toBe("PLA");
    expect(toInitials("x")).toBe("XXX");
    expect(toInitials("a-b")).toBe("ABX");
  });
});

describe("checkInitials", () => {
  it("accepts ordinary trigrams", () => {
    expect(checkInitials("NOV")).toEqual({ ok: true, value: "NOV" });
    expect(checkInitials("abc")).toEqual({ ok: true, value: "ABC" });
  });

  it("rejects the blocklist", () => {
    for (const bad of ["FUK", "SHT", "ASS", "XXX", "KKK"]) {
      expect(checkInitials(bad).ok).toBe(false);
    }
  });

  it("rejects trigrams that unfold to profanity", () => {
    expect(checkInitials("FUC").ok).toBe(false);
    expect(checkInitials("FCK").ok).toBe(false);
    expect(checkInitials("F4G").ok).toBe(false);
  });
});
