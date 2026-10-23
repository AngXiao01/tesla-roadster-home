/**
 * Web Audio mixer with music and SFX buses. Browsers only allow audio after a user gesture, so
 * `unlock()` runs from the Start click. Everything is synthesized: no audio files are shipped.
 * Continuous layers (electric motor, cold-gas hiss, train rumble) are driven every frame by `drive()`.
 */
export type Sfx = 'ui' | 'land' | 'clean' | 'bump' | 'crash' | 'bonus' | 'home' | 'reset' | 'bell' | 'horn'

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private musicTimer = 0
  private musicOn = false
  private motor?: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }
  private hiss?: { gain: GainNode; filter: BiquadFilterNode }
  private rumble?: { gain: GainNode }
  private noise?: AudioBuffer

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.ensureLoops()
  }

  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : music * 0.45, t, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.8, t, 0.05)
  }

  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise
    const len = this.ctx.sampleRate * 2
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1
    this.noise = b
    return b
  }

  private ensureLoops(): void {
    if (this.motor) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 600
    const gain = ctx.createGain()
    gain.gain.value = 0
    osc.connect(filter)
    osc2.connect(filter)
    filter.connect(gain).connect(this.sfx)
    osc.start()
    osc2.start()
    this.motor = { osc, osc2, gain, filter }

    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer()
    src.loop = true
    const hf = ctx.createBiquadFilter()
    hf.type = 'bandpass'
    hf.frequency.value = 2400
    hf.Q.value = 0.7
    const hg = ctx.createGain()
    hg.gain.value = 0
    src.connect(hf).connect(hg).connect(this.sfx)
    src.start()
    this.hiss = { gain: hg, filter: hf }

    const rs = ctx.createBufferSource()
    rs.buffer = this.noiseBuffer()
    rs.loop = true
    const rf = ctx.createBiquadFilter()
    rf.type = 'lowpass'
    rf.frequency.value = 180
    const rg = ctx.createGain()
    rg.gain.value = 0
    rs.connect(rf).connect(rg).connect(this.sfx)
    rs.start()
    this.rumble = { gain: rg }
  }

  /** Per-frame continuous layers. `jet` is 0..~3 total thrust, `train` 0..1 proximity. */
  drive(speed: number, throttle: number, jet: number, train: number, active: boolean): void {
    if (!this.motor || !this.hiss || !this.rumble) return
    const t = this.ctx.currentTime
    const on = active ? 1 : 0
    const f = 70 + speed * 9
    this.motor.osc.frequency.setTargetAtTime(f, t, 0.08)
    this.motor.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.08)
    this.motor.filter.frequency.setTargetAtTime(400 + speed * 40 + Math.abs(throttle) * 300, t, 0.1)
    this.motor.gain.gain.setTargetAtTime(on * (0.03 + Math.min(0.07, speed * 0.003) + Math.abs(throttle) * 0.02), t, 0.1)
    this.hiss.gain.gain.setTargetAtTime(on * Math.min(0.4, jet * 0.16), t, 0.04)
    this.hiss.filter.frequency.setTargetAtTime(1800 + jet * 600, t, 0.05)
    this.rumble.gain.gain.setTargetAtTime(on * train * 0.9, t, 0.2)
  }

  play(name: Sfx): void {
    if (this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const tone = (freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(freq, t + delay)
      o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + delay + dur)
      g.gain.setValueAtTime(0.0001, t + delay)
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
      o.connect(g).connect(this.sfx)
      o.start(t + delay)
      o.stop(t + delay + dur + 0.05)
    }
    switch (name) {
      case 'ui': tone(660, 700, 0.06, 'triangle', 0.16); break
      case 'land': tone(150, 60, 0.14, 'sine', 0.3); break
      case 'clean': tone(150, 60, 0.12, 'sine', 0.25); tone(880, 1320, 0.14, 'triangle', 0.2, 0.05); break
      case 'bump': tone(120, 50, 0.16, 'square', 0.12); break
      case 'crash': tone(200, 40, 0.5, 'sawtooth', 0.25); break
      case 'bonus': tone(990, 1480, 0.12, 'triangle', 0.22); tone(1480, 1760, 0.14, 'sine', 0.16, 0.06); break
      case 'reset': tone(520, 260, 0.3, 'sine', 0.2); break
      case 'bell': tone(1250, 1240, 0.35, 'triangle', 0.12); tone(1870, 1860, 0.25, 'sine', 0.05); break
      case 'horn': tone(311, 309, 0.9, 'sawtooth', 0.08); tone(370, 368, 0.9, 'sawtooth', 0.07); break
      case 'home': [392, 494, 587, 784].forEach((f, i) => tone(f, f * 1.005, 0.6, 'triangle', 0.2, i * 0.16)); break
    }
  }

  /** Gentle evening pad. */
  startMusic(): void {
    if (this.musicOn) return
    this.musicOn = true
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 261.6, 329.6]]
    let bar = 0
    const schedule = () => {
      if (!this.musicOn) return
      const t = this.ctx.currentTime + 0.05
      for (const f of chords[bar % chords.length]) {
        for (const detune of [-6, 6]) {
          const o = this.ctx.createOscillator()
          const g = this.ctx.createGain()
          o.type = 'sine'
          o.frequency.value = f / 2
          o.detune.value = detune
          g.gain.setValueAtTime(0.0001, t)
          g.gain.linearRampToValueAtTime(0.045, t + 1.2)
          g.gain.linearRampToValueAtTime(0.0001, t + 4.2)
          o.connect(g).connect(this.music)
          o.start(t)
          o.stop(t + 4.4)
        }
      }
      bar += 1
      this.musicTimer = window.setTimeout(schedule, 3600)
    }
    schedule()
  }

  stopMusic(): void {
    this.musicOn = false
    clearTimeout(this.musicTimer)
  }
}
