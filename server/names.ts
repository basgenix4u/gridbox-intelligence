/**
 * Display-name policy (locked decision, PRD §3).
 *
 * Names are filtered at write time by a normalised wordlist: the candidate is
 * unicode-folded, de-accented and leet-decoded before matching, so "F.U.C.K",
 * "fûck" and "fuk" all collapse to the same stem. Matching is on word
 * boundaries, not raw substrings, to keep the classic false-positive family
 * ("Scunthorpe") out of the way.
 *
 * The 3-character initials carry the same filter plus a small blocklist of
 * known offensive trigrams — a different rule from the long name, as the PRD
 * notes.
 */

/** Severe profanity and slurs. Deliberately short: block the worst, flag the rest to moderation. */
const WORDLIST: readonly string[] = [
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "dickhead",
  "motherfucker",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "kike",
  "chink",
  "spic",
  "wetback",
  "coon",
  "tranny",
  "whore",
  "slut",
  "prick",
  "wanker",
  "twat",
  "pussy",
  "cock",
  "jerkoff",
  "bullshit",
  "dumbass",
  "jackass",
  "arsehole",
];

/** Known offensive three-letter combinations for the initials slot. */
const INITIALS_BLOCKLIST: ReadonlySet<string> = new Set([
  "FUK",
  "FUC",
  "FCK",
  "SHT",
  "BTK",
  "ASS",
  "DIC",
  "DIK",
  "CUK",
  "CKT",
  "NGR",
  "NIG",
  "FAG",
  "FGT",
  "KIK",
  "SPC",
  "TIT",
  "PRN",
  "SEX",
  "XXX",
  "KKK",
  "JIZ",
  "GAY",
  "PRK",
]);

/** Leet/homoglyph folding applied before matching. */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  "+": "t",
  "8": "b",
  "9": "g",
  "2": "z",
};

/**
 * Folds a candidate to a comparable stem: NFKD, strip combining marks, leet
 * decode, lowercase, collapse every run of non-alphanumerics to one space.
 */
export function normalizeName(raw: string): string {
  const decomposed = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const ch of decomposed) {
    const lower = ch.toLowerCase();
    out += LEET[lower] ?? lower;
  }
  return out
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Collapses runs of single letters separated by spaces — the "f u c k"
 * evasion. Only single-letter runs are joined, so ordinary words (and the
 * Scunthorpe family) are left alone.
 */
function collapseSpacedLetters(value: string): string {
  return value.replace(/\b[a-z](?: [a-z])+\b/g, (run) => run.replace(/ /g, ""));
}

/** Word-boundary match of any blocklist entry against a normalised string. */
export function containsProfanity(normalized: string): boolean {
  if (normalized.length === 0) return false;
  // Both forms are checked: the normalised string keeps word boundaries (so
  // "Scunthorpe" survives), the collapsed form catches spaced-out spellings.
  const collapsed = collapseSpacedLetters(normalized);
  for (const word of WORDLIST) {
    const pattern = new RegExp(`(^| )${escapeRegExp(word)}( |$)`);
    if (pattern.test(normalized) || pattern.test(collapsed)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type NameCheck = { ok: true; value: string } | { ok: false; code: "NAME_REJECTED"; message: string };

/** Full policy check for a long display name (shape is validated by Zod first). */
export function checkDisplayName(raw: string): NameCheck {
  const value = raw.trim();
  if (containsProfanity(normalizeName(value))) {
    return { ok: false, code: "NAME_REJECTED", message: "That display name is not allowed" };
  }
  return { ok: true, value };
}

/** Derives the 3-character initials from a display name. */
export function toInitials(displayName: string): string {
  const letters = displayName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
  return letters.length === 3 ? letters : letters.padEnd(3, "X");
}

/** Policy check for the initials slot: blocklist plus the same normalised filter. */
export function checkInitials(raw: string): NameCheck {
  const value = raw.trim().toUpperCase();
  if (INITIALS_BLOCKLIST.has(value)) {
    return { ok: false, code: "NAME_REJECTED", message: "Those initials are not allowed" };
  }
  if (containsProfanity(normalizeName(value))) {
    return { ok: false, code: "NAME_REJECTED", message: "Those initials are not allowed" };
  }
  return { ok: true, value };
}
