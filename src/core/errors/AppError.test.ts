import { describe, expect, it } from "vitest";
import { AppError, isAppError, toErrorMessage } from "./AppError";

describe("AppError", () => {
  it("carries a code, message and optional details", () => {
    const err = new AppError("RATE_LIMITED", "Too many requests", { retryAfter: 30 });
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toBe("Too many requests");
    expect(err.details).toEqual({ retryAfter: 30 });
  });

  it("is a real Error with a correct prototype chain", () => {
    const err = new AppError("X", "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe("AppError");
    expect(typeof err.stack).toBe("string");
  });

  it("can be thrown and caught", () => {
    expect(() => {
      throw new AppError("NOT_FOUND", "missing");
    }).toThrow(AppError);
  });
});

describe("isAppError", () => {
  it("identifies AppError instances only", () => {
    expect(isAppError(new AppError("A", "a"))).toBe(true);
    expect(isAppError(new Error("a"))).toBe(false);
    expect(isAppError("a")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe("toErrorMessage", () => {
  it("unwraps every kind of thrown value", () => {
    expect(toErrorMessage(new AppError("A", "app message"))).toBe("app message");
    expect(toErrorMessage(new Error("plain message"))).toBe("plain message");
    expect(toErrorMessage("string thrown")).toBe("An unexpected error occurred.");
    expect(toErrorMessage(undefined)).toBe("An unexpected error occurred.");
  });
});
