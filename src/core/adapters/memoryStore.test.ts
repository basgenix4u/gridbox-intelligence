import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./memoryStore";

describe("createMemoryStore", () => {
  it("returns null for a missing key", () => {
    expect(createMemoryStore().get("nope")).toBeNull();
  });

  it("round-trips a value", () => {
    const store = createMemoryStore();
    store.set("k", "v");
    expect(store.get("k")).toBe("v");
  });

  it("seeds from the initial record", () => {
    expect(createMemoryStore({ a: "1" }).get("a")).toBe("1");
  });

  it("removes a key", () => {
    const store = createMemoryStore({ a: "1" });
    store.remove("a");
    expect(store.get("a")).toBeNull();
  });

  it("overwrites on re-set", () => {
    const store = createMemoryStore();
    store.set("k", "1");
    store.set("k", "2");
    expect(store.get("k")).toBe("2");
  });

  it("is isolated between instances", () => {
    const a = createMemoryStore();
    const b = createMemoryStore();
    a.set("k", "1");
    expect(b.get("k")).toBeNull();
  });
});
