/**
 * Audio port.
 *
 * Describes *what the game needs to say*, not how the sound is produced.
 * `Synth` (procedural WebAudio) is one implementation; a silent stub serves
 * headless tests and reduced-motion users, and a future music bed can be
 * added without the engine learning anything new.
 */
export interface AudioSink {
  /** Call from a user gesture: browsers require it before audio may start. */
  unlock(): void;
  /** Master mute. */
  muted: boolean;
  /** When false, gameplay SFX are suppressed but UI clicks still play. */
  gameSounds: boolean;

  collect(combo: number): void;
  move(): void;
  bump(): void;
  hit(): void;
  death(): void;
  pulse(kills: number): void;
  kill(): void;
  ready(): void;
  levelUp(): void;
  spawn(): void;
  deny(): void;
  ui(): void;
  gameOver(): void;
}
