// @vitest-environment jsdom

/**
 * useMute (task 4.1).
 *
 * The persistence is the whole point: a mute button that forgets between
 * reloads is a bug report waiting to happen, and Safari private mode throws on
 * `setItem`, so the write has to be survivable.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMute } from "./useMute";

const KEY = "gridbox-intelligence.muted";

describe("useMute", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts unmuted with nothing stored", () => {
    const { result } = renderHook(() => useMute());
    expect(result.current.muted).toBe(false);
  });

  it("restores a stored preference", () => {
    localStorage.setItem(KEY, "1");
    const { result } = renderHook(() => useMute());
    expect(result.current.muted).toBe(true);
  });

  it("persists on toggle", () => {
    const { result } = renderHook(() => useMute());
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("persists an explicit set", () => {
    const { result } = renderHook(() => useMute());
    act(() => {
      result.current.setMuted(true);
    });
    expect(localStorage.getItem(KEY)).toBe("1");
    act(() => {
      result.current.setMuted(false);
    });
    expect(localStorage.getItem(KEY)).toBe("0");
  });

  it("survives a storage that throws (Safari private mode)", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };
    try {
      const { result } = renderHook(() => useMute());
      // The write failing must not take the hook — or the page — down.
      expect(() =>
        act(() => {
          result.current.toggleMute();
        }),
      ).not.toThrow();
      expect(result.current.muted).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("reads a throwing storage as unmuted rather than crashing on boot", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new DOMException("SecurityError");
    };
    try {
      const { result } = renderHook(() => useMute());
      expect(result.current.muted).toBe(false);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
