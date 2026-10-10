/**
 * Global test setup. Runs once per test file, before any test.
 *
 * Keeps the DOM-free default intact: individual tests that need a DOM opt in
 * by importing `installDomStubs` from `./domStubs`.
 */
import { afterEach } from "vitest";

afterEach(() => {
  // Nothing global to tear down yet; hooks live here so future suites
  // (fake timers, canvas mocks) have one obvious place to register cleanup.
});
