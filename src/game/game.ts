import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { ChaseCamera } from './camera'
import { Car, type CarEvent } from './car'
import { CarView } from './carView'
import type { RouteChoice } from './rules'
import { CONFIG } from './config'
import {
  FLIP, inRailCorridor, LOOPS, RINGS, routeProgress, SAFE_NODES, SPOT, WALLS, Z, zoneAt, ROAD_HALF,
  type Box, type ZoneId,
} from './course'
import { convoyBlocking, convoyBoxes, ConvoyView, createConvoy, startConvoy, stepConvoy } from './convoy'
import { railBoxes, RailView, trainHead, trainSeconds } from './rail'
import {
  addGas, createCrossing, createRun, crossingPassable, stepCrossing, stepGas, triggerCrossing,
  type CrossingPhase, type GasState, type JetOutput, type Light, type RunState,
} from './rules'
import { Scenery } from './scenery'
import { createJam, JamView, jamBoxes, stepJam, type JamCar } from './traffic'
import { tuning } from './tuning'

export type Mode = 'attract' | 'playing' | 'paused' | 'ended'
export type MessageKey =
  | 'msg.shoved' | 'msg.freeEnd' | 'msg.unstuck'
  | 'msg.cleanLanding' | 'msg.ring' | 'msg.crash' | 'msg.fell' | 'msg.rail' | 'msg.reset' | 'msg.noGas'
  | 'msg.checkpoint' | 'msg.train' | 'msg.parkHold' | 'msg.rampStart' | 'msg.loopDone' | 'msg.flipLaunch' | 'msg.rampFail' | 'msg.convoyHop'
export type Hud = {
  gas: number
  gasMax: number
  freeGas: boolean
  kmh: number
  zone: ZoneId
  light: Light
  crossing: CrossingPhase
  crossingArmed: boolean
  convoyBlocking: boolean
  progress: number
  homeMeters: number
  jets: JetOutput
  grounded: boolean
  altitude: number
  park: number
  elapsed: number
}
export type GameHooks = {
  message(key: MessageKey, kind: 'good' | 'bad' | 'info', vars?: Record<string, string | number>): void
  zone(zone: ZoneId): void
  end(run: RunState): void
  /** First-run coaching step (0..COACH_STEPS-1), or -1 when hidden. */
  coach(step: number): void
}
export const COACH_STEPS = 5
const COACH_KEY = 'homejet.coach.v1'

const STATIC: readonly Box[] = WALLS
/** Everything before the jam (office lot + first straight) is a free-play warm-up with unlimited gas. */
const FREE_PLAY_Z = -62

export class Game {
  mode: Mode = 'attract'
  run: RunState = createRun()
  reducedMotion = false
  readonly car = new Car()
  readonly view = new CarView()
  readonly cam = new ChaseCamera()
  private readonly world: Scenery
  private readonly jamView: JamView
  private readonly railView = new RailView()
  private readonly convoyView = new ConvoyView()
  private convoy = createConvoy()
  private airOverConvoy = false
  private gas: GasState = { gas: CONFIG.gas.max, sinceJet: 99 }
  private railWarned = false
  /** Per-section evidence for the results card: air time over the obstacle and time spent stopped. */
  private sec = { jam: { air: false, stop: 0 }, rail: { air: false, stop: 0 }, convoy: { air: false, stop: 0 } }
  private stuck = { t: 0, x: 0, z: 0 }
  private coachState = { step: -1, hold: 0, t: 0 }
  /** Smoothed keyboard steering and throttle (-1..1). */
  private steerS = 0
  private readonly stageEye = new THREE.Vector3()
  private readonly stageLook = new THREE.Vector3()
  private throttleS = 0
  private wasFree = true
  private jets: JetOutput = { rear: 0, lift: 0, side: 0, strafe: 0 }
  private jam: JamCar[] = createJam()
  private jamTime = 0
  private jamStarted = false
  private light: Light = 'red'
  private crossing = createCrossing()
  private safe = 0
  private rings = RINGS.map(() => false)
  private park = 0
  private zone: ZoneId = 'lot'
  private time = 0
  private bellTimer = 0
  private lastPhase: CrossingPhase = 'open'
  private throttle = 0
  private noGasWarned = false
  private readonly prevPos = new THREE.Vector3()
  private readonly prevQuat = new THREE.Quaternion()
  private readonly solids: Box[] = []
  private readonly worldMatrix = new THREE.Matrix4()

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
  ) {
    this.world = new Scenery(renderer.shadowMapSize, renderer.gl)
    this.cam.setOccluders(WALLS)
    this.jamView = new JamView(this.jam.length)
    this.world.scene.add(this.view.root, this.view.shadow, this.view.marker, this.view.puffs, this.jamView.group, this.railView.group, this.convoyView.group)
    this.place(0)
    this.jamView.update(this.jam, this.light, 0)
    this.railView.update(this.crossing, 0)
  }

  get camera(): THREE.PerspectiveCamera {
    return this.cam.camera
  }

  loadModel(): Promise<boolean> {
    return this.view.load()
  }

  start(): void {
    tuning.activate('run')
    this.run = { ...createRun(), unranked: tuning.unranked }
    this.gas = { gas: CONFIG.gas.max, sinceJet: 99 }
    this.wasFree = true
    this.sec = { jam: { air: false, stop: 0 }, rail: { air: false, stop: 0 }, convoy: { air: false, stop: 0 } }
    this.stuck = { t: 0, x: 0, z: 0 }
    let coached = false
    try { coached = localStorage.getItem(COACH_KEY) === '1' } catch { /* storage blocked: coach every run */ }
    this.coachState = { step: coached ? -1 : 0, hold: 0, t: 0 }
    this.steerS = 0
    this.throttleS = 0
    this.hooks.coach(this.coachState.step)
    this.jam = createJam()
    this.jamTime = 0
    this.jamStarted = false
    this.crossing = createCrossing()
    this.convoy = createConvoy()
    this.airOverConvoy = false
    this.safe = 0
    this.rings = RINGS.map(() => false)
    this.rings.forEach((_, i) => this.world.markRing(i, false))
    this.park = 0
    this.zone = 'lot'
    this.noGasWarned = false
    this.view.clear()
    this.place(0)
    this.mode = 'playing'
    this.input.clear()
    this.hooks.zone('lot')
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
    this.input.clear()
  }
  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.clear()
  }
  toTitle(): void {
    this.mode = 'attract'
  }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
    const size = this.renderer.shadowMapSize
    const shadow = this.world.sun.shadow
    shadow.map?.dispose()
    shadow.map = null
    shadow.mapSize.set(size, size)
    this.world.scene.traverse(obj => {
      const material = (obj as THREE.Mesh).material
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
    })
  }

  /** Put the car on a safe node (reset/respawn). */
  private place(index: number): void {
    const n = SAFE_NODES[index]
    this.car.reset(n.x, n.y ?? 0, n.z, n.yaw)
    this.prevPos.copy(this.car.pos)
    this.prevQuat.copy(this.car.quat)
    this.cam.reset(this.car.pos, this.car.cameraYaw)
  }

  private smoothSteer(target: number, dt: number): number {
    const k = CONFIG.input
    const s = this.steerS
    const rate = target === 0 || Math.sign(target) !== Math.sign(s) ? k.steerOut : k.steerIn
    return s + Math.max(-rate * dt, Math.min(rate * dt, target - s))
  }
  private smoothThrottle(target: number, dt: number): number {
    const k = CONFIG.input
    const s = this.throttleS
    this.throttleS = s + Math.max(-k.throttleIn * dt * 1.6, Math.min(k.throttleIn * dt, target - s))
    if (target < 0 && s > 0) this.throttleS = target
    return this.throttleS
  }
  /** First-run coaching: each step completes once the player actually performs it for half a second. */
  private stepCoach(dt: number, mx: number): void {
    const c = this.coachState
    if (c.step < 0) return
    const car = this.car
    const strafe = this.input.held('strafeL') || this.input.held('strafeR')
    const doing = [
      car.speed > 6,
      this.input.held('lift'),
      !car.grounded && (mx !== 0 || strafe),
      this.input.held('boost'),
      false,
    ][c.step]
    c.t += dt
    if (doing) c.hold += dt
    const leftFreeZone = car.pos.z < FREE_PLAY_Z - 4
    const finished = c.step === COACH_STEPS - 1 ? c.t > 5 : c.hold >= 0.5
    if (!finished && !leftFreeZone) return
    const next = leftFreeZone ? -1 : c.step + 1 < COACH_STEPS ? c.step + 1 : -1
    this.coachState = { step: next, hold: 0, t: 0 }
    if (next < 0) {
      try { localStorage.setItem(COACH_KEY, '1') } catch { /* ignore */ }
    }
    this.hooks.coach(next)
  }
  /** Wedged against walls or traffic while trying to move: hop the car up so it can fly free. */
  private unstick(dt: number, wantsMove: boolean): void {
    const c = this.car
    const moved = Math.hypot(c.pos.x - this.stuck.x, c.pos.z - this.stuck.z)
    if (!wantsMove || !c.grounded || moved > 0.6) {
      this.stuck = { t: 0, x: c.pos.x, z: c.pos.z }
      return
    }
    this.stuck.t += dt
    if (this.stuck.t > 1.2) {
      c.pos.y += 2.2
      c.vel.set(0, 6.5, 0)
      c.grounded = false
      this.stuck = { t: 0, x: c.pos.x, z: c.pos.z }
      this.hooks.message('msg.unstuck', 'info')
    }
  }
  private resetToSafe(key: MessageKey): void {
    this.run = { ...this.run, resets: this.run.resets + 1 }
    this.gas = { gas: Math.max(this.gas.gas, CONFIG.gas.resetFloor), sinceJet: 99 }
    this.place(this.safe)
    this.view.clear()
    this.audio.play('reset')
    this.hooks.message(key, key === 'msg.reset' ? 'info' : 'bad')
  }

  step(dt: number): void {
    const resetPressed = this.input.consume('reset')
    this.input.consume('lift')
    this.input.consume('boost')
    const driving = this.mode === 'playing' || this.mode === 'ended'
    // Pausing and the title freeze trains and traffic. Finishing the run does not.
    if (!driving) return
    this.time += dt
    if (this.mode === 'playing') this.run = { ...this.run, elapsed: this.run.elapsed + dt, unranked: this.run.unranked || tuning.unranked }
    this.prevPos.copy(this.car.pos)
    this.prevQuat.copy(this.car.quat)
    const car = this.car

    // Traffic and railway advance first so the car collides with their current positions.
    if (!this.jamStarted && car.pos.z < -60) this.jamStarted = true
    if (this.jamStarted) this.jamTime += dt
    this.light = stepJam(this.jam, this.jamStarted ? this.jamTime : 0, this.jamStarted ? dt : 0, { x: car.pos.x, z: car.pos.z })
    if (car.pos.z < Z.sideRoad1 + 5) this.crossing = triggerCrossing(this.crossing)
    this.crossing = stepCrossing(this.crossing, dt, trainSeconds())
    if (this.crossing.phase !== this.lastPhase) {
      if (this.crossing.phase === 'train' && this.nearRail(160)) this.audio.play('horn')
      this.lastPhase = this.crossing.phase
    }
    if (car.pos.z < -350) this.convoy = startConvoy(this.convoy)
    this.convoy = stepConvoy(this.convoy, dt)
    this.solids.length = 0
    for (const b of STATIC) this.solids.push(b)
    jamBoxes(this.jam, this.solids)
    const moversFrom = this.solids.length
    railBoxes(this.crossing, this.solids)
    convoyBoxes(this.convoy, this.solids)

    // Controls → jets → gas.
    const grounded = car.grounded
    const mx = this.input.move.x
    const my = this.input.move.y
    this.steerS = this.smoothSteer(mx, dt)
    const before = this.gas.gas
    const g = stepGas(this.gas, { rear: this.input.held('boost'), lift: this.input.held('lift'), side: 0, strafe: (this.input.held('strafeR') ? 1 : 0) - (this.input.held('strafeL') ? 1 : 0) }, dt, {
      grounded,
      steady: grounded && car.speed <= CONFIG.car.maxSpeed + 0.5,
    })
    this.gas = g.state
    // Free-play warm-up in the office lot: unlimited gas.
    if (this.freeGas) this.gas = { gas: CONFIG.gas.max, sinceJet: 99 }
    if (this.freeGas !== this.wasFree) {
      if (!this.freeGas) this.hooks.message('msg.freeEnd', 'info')
      this.wasFree = this.freeGas
    }
    // Air A/D drives the attitude jets for free; side is set only so the nozzles puff visibly.
    this.jets = { ...g.out, side: grounded || car.ramp ? 0 : this.steerS }
    this.run = { ...this.run, gasUsed: this.run.gasUsed + g.spent }
    const wantsJet = this.input.held('boost') || this.input.held('lift') || this.input.held('strafeL') || this.input.held('strafeR') 
    if (wantsJet && before <= 0.01 && !this.noGasWarned) {
      this.noGasWarned = true
      this.hooks.message('msg.noGas', 'bad')
    }
    if (this.gas.gas > 20) this.noGasWarned = false
    this.throttle = this.smoothThrottle(my, dt)

    this.shoveOutOfMovers(moversFrom)
    this.unstick(dt, my !== 0 || this.input.held('boost'))
    this.stepCoach(dt, mx)
    const events: CarEvent[] = []
    car.step(dt, { throttle: this.throttle, steer: this.steerS, jets: { ...this.jets, side: 0 } }, this.solids, events)
    for (const e of events) this.onCarEvent(e)
    if (resetPressed) {
      this.resetToSafe('msg.reset')
      return
    }
    if (this.mode !== 'playing') return

    // Rings over the trench: pass through the ring plane inside its radius.
    RINGS.forEach((r, i) => {
      if (this.rings[i]) return
      const crossed = (this.prevPos.z - r.z) * (car.pos.z - r.z) <= 0
      const d = Math.hypot(car.pos.x - r.x, car.pos.y + 0.6 - r.y)
      if (crossed && d < r.r && !car.grounded) {
        this.rings[i] = true
        this.world.markRing(i, true)
        this.gas = { ...this.gas, gas: addGas(this.gas.gas, CONFIG.gas.ringBonus) }
        this.audio.play('bonus')
        this.hooks.message('msg.ring', 'good', { gas: CONFIG.gas.ringBonus })
      }
    })

    // The railway corridor is off limits unless the crossing is open or the car is on the bridge.
    if (inRailCorridor(car.pos.z) && !crossingPassable(this.crossing)) {
      if (!this.railWarned) this.hooks.message('msg.rail', 'bad')
      this.railWarned = true
    } else if (!inRailCorridor(car.pos.z)) this.railWarned = false

    // Route choices for the results card.
    const zone = zoneAt(car.pos.x, car.pos.z, car.pos.y)
    // Evidence per section: airborne above the traffic/tracks, or stopped and waiting.
    const airborne = !car.grounded && car.pos.y > 1.3
    const stopped = car.grounded && car.speed < 1.2
    const secKey = zone === 'jam' ? 'jam' : zone === 'railApproach' ? 'rail' : zone === 'convoy' ? 'convoy' : null
    if (secKey) {
      const sc = this.sec[secKey]
      if (airborne) sc.air = true
      if (stopped) sc.stop += dt
    }
    if (inRailCorridor(car.pos.z) && airborne) this.sec.rail.air = true
    const verdict = (sc: { air: boolean; stop: number }, jetted: boolean): RouteChoice => (jetted || sc.air ? 'jet' : sc.stop > 1.5 ? 'waited' : 'drove')
    if (this.run.jam === null && car.pos.z < Z.stopLine - 6) this.run = { ...this.run, jam: verdict(this.sec.jam, false) }
    if (this.run.rail === null && car.pos.z < Z.fenceFar - 1) this.run = { ...this.run, rail: verdict(this.sec.rail, car.pos.x < -ROAD_HALF - 0.5) }
    if (car.pos.z < Z.convoyNear && car.pos.z > Z.convoyFar && !car.grounded && car.pos.y > 1.5) this.airOverConvoy = true
    if (this.run.convoy === null && car.pos.z < Z.convoyFar - 1) {
      this.run = { ...this.run, convoy: verdict(this.sec.convoy, this.airOverConvoy) }
      if (this.airOverConvoy) this.hooks.message('msg.convoyHop', 'good')
    }
    if (zone !== this.zone) {
      this.zone = zone
      this.hooks.zone(zone)
    }

    // Safe nodes: the furthest node passed while on the ground.
    for (let i = this.safe + 1; i < SAFE_NODES.length; i += 1) {
      if (car.grounded && car.pos.z < SAFE_NODES[i].z - 3 && Math.abs(car.pos.x) < ROAD_HALF + 1) {
        this.safe = i
        this.hooks.message('msg.checkpoint', 'info')
      }
    }

    // Home: crossing the front line of the house apron anywhere (driving, off-road or flying over the roof) ends the trip.
    // The results card can show, but the car stays in this world and keeps the controls.
    if (car.pos.z < SPOT.z1) {
      this.run = { ...this.run, phase: 'home' }
      this.mode = 'ended'
      this.audio.play('home')
      this.hooks.end(this.run)
    }
  }

  private onCarEvent(e: CarEvent): void {
    if (e.type === 'land') {
      if (e.landing === 'crash') {
        this.cam.addShake(0.9)
        this.audio.play('crash')
        this.hooks.message('msg.crash', 'bad')
        return
      }
      this.cam.addShake(Math.min(0.6, e.impact / 25))
      if (e.landing === 'clean') {
        this.gas = { ...this.gas, gas: addGas(this.gas.gas, CONFIG.gas.landingBonus) }
        this.run = { ...this.run, cleanLandings: this.run.cleanLandings + 1 }
        this.audio.play('clean')
        this.hooks.message('msg.cleanLanding', 'good', { gas: CONFIG.gas.landingBonus })
      } else this.audio.play('land')
      this.rings = this.rings.map(() => false)
      this.rings.forEach((_, i) => this.world.markRing(i, false))
    } else if (e.type === 'bump') {
      this.audio.play('bump')
      this.cam.addShake(Math.min(0.5, e.strength / 20))
    } else if (e.type === 'rampStart') {
      this.hooks.message('msg.rampStart', 'info')
    } else if (e.type === 'loopDone') {
      this.run = { ...this.run, loops: this.run.loops + 1 }
      this.cam.addShake(0.25)
      this.hooks.message('msg.loopDone', 'good', { n: this.run.loops, total: LOOPS.length })
    } else if (e.type === 'flipLaunch') {
      this.run = { ...this.run, flips: this.run.flips + 1 }
      this.cam.addShake(0.3)
      this.hooks.message('msg.flipLaunch', 'good')
    } else if (e.type === 'rampFail') {
      this.hooks.message('msg.rampFail', 'bad')
    } else if (e.type === 'fell') {
      const c = this.car
      const v = c.vel.clone().multiplyScalar(0.3)
      c.reset(Math.max(-ROAD_HALF + 1, Math.min(ROAD_HALF - 1, c.pos.x)), 0, c.pos.z, c.cameraYaw)
      c.vel.set(v.x, 0, v.z)
      this.hooks.message('msg.fell', 'info')
    }
  }

  /** The office lot is a free-play warm-up area with unlimited gas. */
  get freeGas(): boolean {
    return this.car.pos.z > FREE_PLAY_Z
  }
  /** Moving obstacles (train, trucks, barriers) shove the car out instead of resetting the run. */
  private shoveOutOfMovers(from: number): void {
    const car = this.car
    const p = car.pos
    for (let i = from; i < this.solids.length; i += 1) {
      const b = this.solids[i]
      const inside = p.x > b.min[0] - 0.9 && p.x < b.max[0] + 0.9 && p.z > b.min[2] - 2 && p.z < b.max[2] + 2 && p.y + 0.6 > b.min[1] && p.y < b.max[1]
      if (!inside) continue
      // Push out along Z to the nearer side, knock the car up and sideways a bit.
      const cz = (b.min[2] + b.max[2]) / 2
      const dir = p.z >= cz ? 1 : -1
      p.z = dir > 0 ? b.max[2] + 2.1 : b.min[2] - 2.1
      car.vel.set(car.vel.x + (Math.random() - 0.5) * 6, 7, dir * 9)
      car.grounded = false
      this.cam.addShake(0.8)
      this.audio.play('crash')
      this.hooks.message('msg.shoved', 'bad')
      return
    }
  }
  private nearRail(dist: number): boolean {
    return Math.abs(this.car.pos.z - Z.track) < dist
  }

  get hud(): Hud {
    const c = this.car
    return {
      gas: this.gas.gas,
      gasMax: CONFIG.gas.max,
      freeGas: this.freeGas,
      kmh: Math.round(Math.hypot(c.vel.x, c.vel.z) * 3.6),
      zone: this.zone,
      light: this.light,
      crossing: this.crossing.phase,
      crossingArmed: this.crossing.armed,
      convoyBlocking: convoyBlocking(this.convoy),
      progress: routeProgress(c.pos.z),
      homeMeters: Math.max(0, Math.round(c.pos.z - SPOT.z1)),
      jets: this.jets,
      grounded: c.grounded,
      altitude: Math.max(0, c.pos.y - Math.max(0, c.supportAt(c.pos.x, c.pos.z, c.pos.y, this.solids))),
      park: this.park / CONFIG.park.holdSeconds,
      elapsed: this.run.elapsed,
    }
  }

  render(alpha: number, dt: number): void {
    const t = performance.now() / 1000
    const live = this.mode === 'playing' || this.mode === 'ended'
    const a = live ? alpha : 1
    const pos = new THREE.Vector3().lerpVectors(this.prevPos, this.car.pos, a)
    const quat = new THREE.Quaternion().slerpQuaternions(this.prevQuat, this.car.quat, a)
    this.view.root.position.copy(pos)
    this.view.root.quaternion.copy(quat)
    // Small visual body roll into turns on the ground.
    this.view.body.rotation.z = this.car.grounded ? -this.car.steerVisual * Math.min(1, this.car.speed / 20) * 0.05 : 0
    this.view.root.updateMatrixWorld()
    this.worldMatrix.copy(this.view.root.matrixWorld)
    if (live) this.view.emit(this.jets, this.worldMatrix, this.car.vel, dt)
    this.view.update(dt)
    // Ground shadow and landing marker.
    const ground = this.car.supportAt(pos.x, pos.z, pos.y + 0.01, this.solids.length ? this.solids : STATIC)
    const h = Math.max(0, pos.y - ground)
    this.view.shadow.position.set(pos.x, ground + 0.04, pos.z)
    this.view.shadow.rotation.y = this.car.yaw
    const sm = this.view.shadow.material as THREE.MeshBasicMaterial
    sm.opacity = 0.45 / (1 + h * 0.12)
    this.view.marker.visible = live && !this.car.grounded && h > 0.8 && ground > -20
    this.view.marker.position.set(pos.x, ground + 0.06, pos.z)
    ;(this.view.marker.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.3 * Math.sin(t * 8)

    if (this.mode === 'attract') {
      const k = t * 0.06
      this.cam.camera.position.set(Math.sin(k) * 16, 6 + Math.sin(t * 0.3), -6 + Math.cos(k) * 16)
      this.cam.camera.lookAt(0, 1, -6)
    } else {
      // On a loop, cut to a broadcast shot from the left-front so the inverted car is in view.
      const r = this.car.ramp
      let stage: { eye: THREE.Vector3; look: THREE.Vector3 } | null = null
      if (r && r.kind === 'loop') {
        const l = LOOPS[r.loop]
        this.stageEye.set(-15, l.radius + 1.5, l.zEntry + 6)
        this.stageLook.set(pos.x * 0.6, pos.y * 0.6 + l.radius * 0.4 + 0.6, pos.z * 0.6 + l.zEntry * 0.4)
        stage = { eye: this.stageEye, look: this.stageLook }
      } else if (r && r.kind === 'flip') {
        // Open (left) side of the curl, a little ahead: the car spirals up the far wall towards us.
        this.stageEye.set(-13, FLIP.radius + 2, pos.z - 10)
        this.stageLook.set(pos.x, pos.y + 0.6, pos.z - 2)
        stage = { eye: this.stageEye, look: this.stageLook }
      }
      this.cam.update(pos, this.car.cameraYaw, this.car.speed, this.car.grounded && !this.car.ramp, dt, false, this.reducedMotion, stage)
    }

    this.jamView.update(this.jam, this.light, t)
    this.world.setLight(this.light)
    this.railView.update(this.crossing, t)
    this.convoyView.update(this.convoy)
    const arrived = this.mode === 'ended' && this.run.phase === 'home'
    this.world.update(dt, pos, t, arrived, this.zone === 'home')

    // Crossing bell and train rumble.
    let train = 0
    if (this.crossing.phase === 'train') {
      const head = trainHead(this.crossing.train)
      const dx = Math.max(0, Math.abs(pos.x - (head - 50)) - 50)
      train = Math.max(0, 1 - Math.hypot(dx, pos.z - Z.track) / 140)
    }
    if (live && this.crossing.phase !== 'open' && this.nearRail(130)) {
      this.bellTimer -= dt
      if (this.bellTimer <= 0) {
        this.audio.play('bell')
        this.bellTimer = 0.55
      }
    }
    const jet = this.jets.rear + this.jets.lift + Math.abs(this.jets.side) + Math.abs(this.jets.strafe ?? 0)
    this.audio.drive(this.car.speed, this.throttle, live ? jet : 0, train, live)
    this.renderer.render(this.world.scene, this.cam.camera)
  }

  /** Test hook: put the car at a position with zero velocity. */
  debugTeleport(x: number, y: number, z: number, yaw = 0): void {
    this.car.reset(x, y, z, yaw)
    this.prevPos.copy(this.car.pos)
    this.prevQuat.copy(this.car.quat)
  }
  get crossingState() {
    return this.crossing
  }
  get gasLevel(): number {
    return this.gas.gas
  }
  get jamCars(): readonly JamCar[] {
    return this.jam
  }
  get safeIndex(): number {
    return this.safe
  }
}
