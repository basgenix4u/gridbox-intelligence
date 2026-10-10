import { afterEach, describe, expect, it } from "vitest";
import { createLocalStorageStore } from "./localStorageStore";

/**
 * Exercises the adapter against a fake `localStorage`, including the failure
 * modes the real one has: absent storage, disabled storage (throws) and
 * quota-exceeded writes. A game must never lose a run because persistence
 * hiccuped, so every one of these must degrade quietly.
 */
function installFakeLocalStorage(behaviour: { throwOnSet?: boolean } = {}): Map<string, string> {
  const map = new Map<string, string>();
  const fake = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (behaviour.throwOnSet) throw new DOMException("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as unknown as Record<string, unknown>).localStorage = fake;
  return map;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).localStorage;
});

describe("createLocalStorageStore", () => {
  it("round-trips values through localStorage", () => {
    installFakeLocalStorage();
    const store = createLocalStorageStore();
    store.set("a", "1");
    expect(store.get("a")).toBe("1");
  });

  it("removes values", () => {
    installFakeLocalStorage();
    const store = createLocalStorageStore();
    store.set("a", "1");
    store.remove("a");
    expect(store.get("a")).toBeNull();
  });

  it("degrades to a no-op when localStorage is absent", () => {
    // No install: `localStorage` is undefined under Node.
    const store = createLocalStorageStore();
    expect(store.get("a")).toBeNull();
    expect(() => store.set("a", "1")).not.toThrow();
    expect(() => store.remove("a")).not.toThrow();
    expect(store.get("a")).toBeNull();
  });

  it("degrades to a no-op when storage is disabled (probe throws)", () => {
    const map = installFakeLocalStorage({ throwOnSet: true });
    const store = createLocalStorageStore();
    expect(() => store.set("a", "1")).not.toThrow();
    expect(map.size).toBe(0);
    expect(store.get("a")).toBeNull();
  });

  it("swallows a quota error mid-session instead of crashing a run", () => {
    const map = installFakeLocalStorage();
    const store = createLocalStorageStore();
    store.set("ok", "1");
    expect(map.get("ok")).toBe("1");

    // Now make writes start failing, as a full quota would.
    Object.assign(globalThis.localStorage, {
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
    });
    expect(() => store.set("later", "2")).not.toThrow();
  });
});
