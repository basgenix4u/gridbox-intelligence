/** Wall/monotonic clock port. Exists so time can be controlled in tests. */
export interface Clock {
  /** Monotonic milliseconds, suitable for delta timing. */
  now(): number;
  /** Wall-clock epoch milliseconds, suitable for timestamps. */
  wallNow(): number;
}
