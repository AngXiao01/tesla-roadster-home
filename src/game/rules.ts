import { CONFIG, type Config } from './config'

/**
 * Pure rules: gas budget, railway crossing state machine, traffic light, landing and parking.
 * No three.js, no DOM — the scene reports facts and reads the results; unit tests cover each rule.
 */

// ─── run ────────────────────────────────────────────────────────────────────
export type RunPhase = 'driving' | 'home'
export type RouteChoice = 'waited' | 'jet' | 'drove' | null
export type RunState = {
  unranked: boolean
  phase: RunPhase
  elapsed: number
  resets: number
  gasUsed: number
  cleanLandings: number
  jam: RouteChoice
  rail: RouteChoice
  convoy: RouteChoice
  stunt: RouteChoice
  /** Loops completed on this run. */
  loops: number
  /** Roadster flips landed on this run. */
  flips: number
}

export function createRun(): RunState {
  return { unranked: false, phase: 'driving', elapsed: 0, resets: 0, gasUsed: 0, cleanLandings: 0, jam: null, rail: null, convoy: null, stunt: null, loops: 0, flips: 0 }
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

// ─── gas ────────────────────────────────────────────────────────────────────
export type JetRequest = { rear: boolean; lift: boolean; side: number; strafe?: number }
export type JetOutput = { rear: number; lift: number; side: number; strafe?: number }
export type GasState = { gas: number; sinceJet: number }

/**
 * Spend gas for the requested jets and regenerate when allowed. When the tank cannot cover the
 * whole request, every active jet is scaled by the same fraction, so thrust fades instead of
 * cutting one jet. Regeneration only happens on the ground, without jetting, after a short delay.
 */
export function stepGas(
  s: GasState,
  req: JetRequest,
  dt: number,
  env: { grounded: boolean; steady: boolean },
  cfg: Config = CONFIG,
): { state: GasState; out: JetOutput; spent: number } {
  const g = cfg.gas
  const side = Math.max(-1, Math.min(1, req.side))
  const strafe = Math.max(-1, Math.min(1, req.strafe ?? 0))
  const demand = ((req.rear ? g.costRear : 0) + (req.lift ? g.costLift : 0) + (Math.abs(side) + Math.abs(strafe)) * g.costSide) * dt
  let gas = s.gas
  let scale = 0
  if (demand > 0 && gas > 0) scale = Math.min(1, gas / demand)
  const spent = demand * scale
  gas -= spent
  const jetting = spent > 0
  const sinceJet = jetting ? 0 : s.sinceJet + dt
  if (!jetting && env.grounded && env.steady && sinceJet >= g.regenDelay) gas += g.regen * dt
  gas = Math.max(0, Math.min(g.max, gas))
  return {
    state: { gas, sinceJet },
    out: { rear: req.rear ? scale : 0, lift: req.lift ? scale : 0, side: side * scale, strafe: strafe * scale },
    spent,
  }
}

export function addGas(gas: number, amount: number, cfg: Config = CONFIG): number {
  return Math.max(0, Math.min(cfg.gas.max, gas + amount))
}

// ─── landing ────────────────────────────────────────────────────────────────
export type Landing = 'crash' | 'clean' | 'rough'
/** `upright` is the dot product of body up with world up (1 = level). */
export function classifyLanding(impact: number, upright: number, airTime: number, cfg: Config = CONFIG): Landing {
  if (impact > cfg.car.crashImpact || upright < 0.55) return 'crash'
  if (airTime >= cfg.gas.landingMinAir && upright > 0.93 && impact < cfg.car.crashImpact * 0.7) return 'clean'
  return 'rough'
}

// ─── traffic light at the end of the jam ────────────────────────────────────
export type Light = 'green' | 'red'
/** The light starts red so the jam is visible on arrival. */
export function trafficLight(t: number, cfg: Config = CONFIG): Light {
  const cycle = cfg.traffic.red + cfg.traffic.green
  const m = ((t % cycle) + cycle) % cycle
  return m < cfg.traffic.red ? 'red' : 'green'
}

// ─── railway crossing ───────────────────────────────────────────────────────
export type CrossingPhase = 'open' | 'warning' | 'closed' | 'train' | 'clearing' | 'opening'
export type CrossingState = {
  phase: CrossingPhase
  /** Seconds spent in the current phase. */
  time: number
  /** 0..1 progress of the train across its run while in `train`. */
  train: number
  /** 0 = gates up, 1 = gates down. */
  gate: number
}

const ORDER: CrossingPhase[] = ['warning', 'closed', 'train', 'clearing', 'opening', 'open']

export function crossingDuration(phase: CrossingPhase, trainSeconds: number, cfg: Config = CONFIG): number {
  const r = cfg.rail
  switch (phase) {
    case 'warning': return r.warning
    case 'closed': return r.closed
    case 'train': return trainSeconds
    case 'clearing': return r.clearing
    case 'opening': return r.opening
    case 'open': return r.openGap
  }
}

/** The crossing idles `open` until `trigger()` starts its first cycle, then repeats. */
export function createCrossing(): CrossingState & { armed: boolean } {
  return { phase: 'open', time: 0, train: 0, gate: 0, armed: false }
}

export function stepCrossing(
  s: CrossingState & { armed: boolean },
  dt: number,
  trainSeconds: number,
  cfg: Config = CONFIG,
): CrossingState & { armed: boolean } {
  if (!s.armed) return s
  let phase = s.phase
  let time = s.time + dt
  // Several phases can elapse in one long step; walk through them in order.
  for (let guard = 0; guard < 8; guard += 1) {
    const d = crossingDuration(phase, trainSeconds, cfg)
    if (time < d) break
    time -= d
    phase = ORDER[(ORDER.indexOf(phase) + 1) % ORDER.length]
  }
  const d = crossingDuration(phase, trainSeconds, cfg)
  const k = Math.min(1, time / Math.max(1e-6, d))
  const gate = phase === 'warning' ? Math.max(0, (k - 0.45) / 0.55)
    : phase === 'opening' ? 1 - k
    : phase === 'open' ? 0 : 1
  return { armed: true, phase, time, gate, train: phase === 'train' ? k : phase === 'clearing' || phase === 'opening' || phase === 'open' ? 1 : 0 }
}

export function triggerCrossing(s: CrossingState & { armed: boolean }): CrossingState & { armed: boolean } {
  if (s.armed) return s
  return { ...s, armed: true, phase: 'warning', time: 0 }
}

/** Ground traffic may cross only while fully open. */
export function crossingPassable(s: CrossingState): boolean {
  return s.phase === 'open' || (s.phase === 'opening' && s.gate < 0.15)
}

// ─── parking at home ────────────────────────────────────────────────────────
export function stepParking(
  hold: number,
  car: { inSpot: boolean; speed: number; grounded: boolean; upright: number },
  dt: number,
  cfg: Config = CONFIG,
): { hold: number; done: boolean } {
  const ok = car.inSpot && car.grounded && car.speed <= cfg.park.maxSpeed && car.upright > 0.9
  const next = ok ? hold + dt : 0
  return { hold: next, done: next >= cfg.park.holdSeconds }
}
