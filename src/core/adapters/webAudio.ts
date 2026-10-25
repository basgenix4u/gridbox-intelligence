import type { AudioSink } from "@/core/ports/audio";

type OscType = OscillatorType;

/**
 * Tiny procedural synth. Everything is generated with oscillators + filtered noise,
 * so there are no assets to load. The AudioContext is created lazily on the first
 * user gesture (required by mobile browsers).
 */
export class Synth implements AudioSink {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private _muted = false;
  /** Game SFX are silenced in attract mode; UI clicks still play. */
  gameSounds = true;

  unlock(): void {
    if (!this.ctx) {
      const w = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AC = window.AudioContext || w.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Private: React must go through `setMuted`, not poke the field. */
  private set muted(v: boolean) {
    this._muted = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.5;
  }

  /**
   * Mute on or off, applying the gain immediately. A method rather than a bare
   * assignment because callers are React components: writing a field on an
   * object a component also holds is what `react-hooks/immutability` (rightly)
   * flags.
   */
  setMuted(v: boolean): void {
    this.muted = v;
  }

  private tone(type: OscType, freq: number, dur: number, vol: number, slideTo?: number, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master || this._muted) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  private noise(dur: number, vol: number, freq = 1200, type: BiquadFilterType = "lowpass", delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noiseBuf || this._muted) return;
    const t0 = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0);
    s.stop(t0 + dur + 0.03);
  }

  // ---------------- game sfx ----------------

  collect(combo: number): void {
    if (!this.gameSounds) return;
    const f = 523 * Math.pow(2, Math.min(combo, 8) / 12);
    this.tone("square", f, 0.08, 0.1, f * 1.4);
    this.tone("sine", f * 2, 0.14, 0.06);
  }

  move(): void {
    if (!this.gameSounds) return;
    this.tone("triangle", 190, 0.03, 0.03, 130);
  }

  bump(): void {
    if (!this.gameSounds) return;
    this.tone("square", 95, 0.06, 0.06, 60);
  }

  hit(): void {
    if (!this.gameSounds) return;
    this.noise(0.3, 0.35, 900);
    this.tone("sawtooth", 180, 0.4, 0.22, 40);
  }

  death(): void {
    if (!this.gameSounds) return;
    this.noise(0.8, 0.4, 600);
    this.tone("sawtooth", 220, 1.0, 0.28, 25);
    this.tone("square", 110, 1.2, 0.18, 20);
  }

  pulse(kills: number): void {
    if (!this.gameSounds) return;
    this.tone("sine", 140, 0.45, 0.32, 1200);
    this.noise(0.35, 0.22, 2500, "highpass");
    if (kills > 0) this.tone("square", 70, 0.3, 0.28, 30, 0.05);
  }

  kill(): void {
    if (!this.gameSounds) return;
    this.tone("square", 100, 0.14, 0.18, 35);
    this.noise(0.1, 0.14, 1500);
  }

  ready(): void {
    if (!this.gameSounds) return;
    [660, 880, 1320].forEach((f, i) => this.tone("sine", f, 0.12, 0.12, undefined, i * 0.07));
  }

  levelUp(): void {
    if (!this.gameSounds) return;
    [440, 554, 659, 880].forEach((f, i) => this.tone("triangle", f, 0.18, 0.15, undefined, i * 0.09));
  }

  spawn(): void {
    if (!this.gameSounds) return;
    this.tone("triangle", 320, 0.1, 0.045, 180);
  }

  deny(): void {
    if (!this.gameSounds) return;
    this.tone("square", 150, 0.07, 0.07, 120);
  }

  // ---------------- ui ----------------

  ui(): void {
    this.tone("sine", 900, 0.05, 0.06, 1300);
  }

  gameOver(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone("triangle", f, 0.3, 0.16, undefined, i * 0.16));
  }
}
