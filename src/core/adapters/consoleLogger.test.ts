import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleLogger, createSilentLogger } from "./consoleLogger";

describe("createConsoleLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prefixes and forwards messages to the matching console level", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    createConsoleLogger("test").info("hello", { a: 1 });
    expect(info).toHaveBeenCalledWith("[test]", "hello", { a: 1 });
  });

  it("omits meta when none is given", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createConsoleLogger().warn("careful");
    expect(warn).toHaveBeenCalledWith("[gridbox]", "careful");
  });
});

describe("createSilentLogger", () => {
  it("never touches the console", () => {
    const spies = (["debug", "info", "warn", "error"] as const).map((l) =>
      vi.spyOn(console, l).mockImplementation(() => undefined),
    );
    const log = createSilentLogger();
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d", { e: 1 });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
