import * as THREE from 'three'
import { CONFIG } from './config'
import { CEILINGS, FLIP, flipAt, flipPoint, groundAt, LOOP_MIN_SPEED, loopAt, loopMergeAt, loopPoint, LOOPS, loopShiftRate, type Box } from './course'
import { classifyLanding, type JetOutput, type Landing } from './rules'

export type CarEvent =
  | { type: 'takeoff' }
  | { type: 'land'; impact: number; landing: Landing; airTime: number; upright: number }
  | { type: 'bump'; strength: number }
  | { type: 'fell' }
  | { type: 'rampStart'; loop: number }
  | { type: 'loopDone'; loop: number; speed: number }
  | { type: 'flipLaunch'; speed: number }
  | { type: 'rampFail' }

export type CarControls = { throttle: number; steer: number; jets: JetOutput }

/** Car footprint: two circles along the body axis, plus body height. */
export const CAR = { radius: 1.0, axle: 1.25, height: 1.3, length: 4.4, width: 2.0 }

const UP = new THREE.Vector3(0, 1, 0)
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
/** Duration of the scripted mid-air roll after the flip ramp (s). */
const FLIP_SECONDS = 0.75
const TWO_PI = Math.PI * 2
const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()

/**
 * Arcade vehicle with a simple rigid-body air phase. On the ground it behaves like an electric
 * car (pedals, grip, speed-sensitive steering). Jets push along the body's own axes: rear along
 * body forward, lift along body up, side jets create yaw torque. Gas accounting lives in rules.
 */
export class Car {
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  readonly angVel = new THREE.Vector3()
  grounded = true
  airTime = 0
  /** Last yaw rate on the ground (for visuals). */
  steerVisual = 0
  /** Riding loop `loop`: angle 0 (entry) → π (inverted at the top) → 2π (exit). */
  ramp: { kind: 'loop' | 'flip'; loop: number; theta: number; speed: number; x0: number } | null = null
  /** Smoothed ground yaw rate (rad/s): gives the steering a little angular inertia. */
  private yawRateG = 0
  /** Seconds left of the scripted roll that turns the car upright after leaving the ramp. */
  flipTimer = 0
  /** Set when the last launch came off the ramp (for scoring the stunt). */
  launchedFromRamp = false

  reset(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z)
    this.vel.set(0, 0, 0)
    this.angVel.set(0, 0, 0)
    this.quat.setFromAxisAngle(UP, yaw)
    this.grounded = true
    this.airTime = 0
    this.ramp = null
    this.flipTimer = 0
    this.launchedFromRamp = false
    this.yawRateG = 0
  }

  /** Yaw the chase camera should follow (fixed down the road while on a loop so the view does not spin). */
  get cameraYaw(): number {
    return this.ramp ? 0 : this.yaw
  }

  get yaw(): number {
    const f = this.forward(tmpV)
    return Math.atan2(-f.x, -f.z)
  }
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat)
  }
  up(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quat)
  }
  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quat)
  }
  get upright(): number {
    return this.up(tmpV).y
  }
  /** Signed speed along the body's forward axis, ground plane only. */
  get forwardSpeed(): number {
    const f = this.forward(new THREE.Vector3())
    f.y = 0
    if (f.lengthSq() < 1e-6) return 0
    return this.vel.dot(f.normalize())
  }
  get speed(): number {
    return this.vel.length()
  }

  step(dt: number, c: CarControls, solids: readonly Box[], events: CarEvent[]): void {
    if (this.ramp) {
      if (this.ramp.kind === 'flip') this.stepFlip(dt, c, events)
      else this.stepRamp(dt, c, events)
      return
    }
    if (this.grounded) this.stepGround(dt, c)
    else this.stepAir(dt, c)
    this.pos.addScaledVector(this.vel, dt)
    this.collide(solids, events)
    this.resolveGround(dt, events, solids)
    if (this.pos.y < -12) events.push({ type: 'fell' })
    // Entering a loop: on the ground, heading down the road, at a loop foot (left lane).
    if (this.grounded && this.forward(tmpV).z < -0.5 && this.forwardSpeed > 1) {
      const li = loopAt(this.pos.x, this.pos.z)
      if (li >= 0) {
        this.ramp = { kind: 'loop', loop: li, theta: 0, speed: Math.max(LOOP_MIN_SPEED, this.forwardSpeed), x0: THREE.MathUtils.clamp(this.pos.x, -3.8, -0.6) }
        this.launchedFromRamp = false
        events.push({ type: 'rampStart', loop: li })
      } else if (flipAt(this.pos.x, this.pos.z)) {
        this.ramp = { kind: 'flip', loop: -1, theta: 0, speed: Math.max(FLIP.minSpeed, this.forwardSpeed), x0: this.pos.x }
        this.launchedFromRamp = false
        events.push({ type: 'rampStart', loop: -1 })
      }
    }
  }

  private stepRamp(dt: number, c: CarControls, events: CarEvent[]): void {
    const r = this.ramp!
    const l = LOOPS[r.loop]
    const k = CONFIG.car
    // Arcade loop: softened gravity along the track; the motor and rear jet push along it.
    r.speed += (k.gravity * 0.6 * Math.sin(r.theta) + c.jets.rear * CONFIG.jets.rear + Math.max(0, c.throttle) * k.accel * 0.3) * dt
    r.speed = Math.min(r.speed, k.jetMaxSpeed)
    r.theta += (r.speed / l.radius) * dt
    const th = Math.min(TWO_PI, r.theta)
    const tangent = new THREE.Vector3(loopShiftRate(th) / l.radius, Math.sin(th), -Math.cos(th))
    if (r.speed < 5.5 && th > Math.PI * 0.3 && th < Math.PI * 1.7) {
      // Too slow: the car peels off the track and falls.
      this.ramp = null
      this.grounded = false
      this.airTime = 0.01
      this.vel.copy(tangent).multiplyScalar(Math.max(0, r.speed))
      events.push({ type: 'rampFail' })
      return
    }
    const p = loopPoint(r.loop, th, r.x0)
    this.pos.set(p.x, p.y, p.z)
    this.quat.setFromAxisAngle(AXIS_X, th)
    this.vel.copy(tangent).multiplyScalar(r.speed)
    if (r.theta >= TWO_PI) {
      // Back on the road in the right lane, heading on down the route at loop speed.
      this.ramp = null
      this.grounded = true
      this.pos.y = 0
      this.vel.set(0, 0, -r.speed)
      this.quat.identity()
      this.angVel.set(0, 0, 0)
      this.yawRateG = 0
      this.launchedFromRamp = true
      events.push({ type: 'loopDone', loop: r.loop, speed: r.speed })
    }
  }

  /** Roadster flip: spiral up the curl onto its ceiling, leave the lip inverted, roll upright mid-air. */
  private stepFlip(dt: number, c: CarControls, events: CarEvent[]): void {
    const r = this.ramp!
    const k = CONFIG.car
    const pathLen = Math.hypot(Math.PI * FLIP.radius, FLIP.length)
    r.speed += (c.jets.rear * CONFIG.jets.rear + Math.max(0, c.throttle) * k.accel * 0.3) * dt
    r.speed = THREE.MathUtils.clamp(r.speed, FLIP.minSpeed, k.jetMaxSpeed)
    r.theta += (r.speed / pathLen) * dt
    const s = Math.min(1, r.theta)
    const p = flipPoint(s, r.x0)
    const a = flipPoint(Math.max(0, s - 0.01), r.x0)
    const b = flipPoint(Math.min(1, s + 0.01), r.x0)
    const tangent = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize()
    // Wheels on the inside of the curl: "up" points at the tube axis.
    const up = new THREE.Vector3(-Math.sin(p.phi), Math.cos(p.phi), 0)
    up.addScaledVector(tangent, -up.dot(tangent)).normalize()
    const back = tangent.clone().negate()
    const right = new THREE.Vector3().crossVectors(up, back).normalize()
    this.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back))
    this.pos.set(p.x, p.y, p.z)
    this.vel.copy(tangent).multiplyScalar(r.speed)
    if (r.theta >= 1) {
      // Off the lip upside down, heading on down the road; a scripted half roll rights the car.
      this.ramp = null
      this.grounded = false
      this.airTime = 0.01
      this.pos.y = FLIP.radius * 2 - CAR.height
      this.vel.set(0, 3.5, -Math.max(r.speed, FLIP.minSpeed))
      this.quat.setFromAxisAngle(AXIS_Z, Math.PI)
      this.angVel.set(0, 0, -Math.PI / FLIP_SECONDS)
      this.flipTimer = FLIP_SECONDS
      this.launchedFromRamp = true
      events.push({ type: 'flipLaunch', speed: r.speed })
    }
  }

  private stepGround(dt: number, c: CarControls): void {
    const k = CONFIG.car
    const yaw = this.yaw
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    let vF = this.vel.dot(f)
    let vL = this.vel.dot(r)
    const t = THREE.MathUtils.clamp(c.throttle, -1, 1)
    if (t > 0) {
      if (vF < -0.3) vF = Math.min(0, vF + k.brake * dt)
      else if (vF < k.maxSpeed) vF = Math.min(k.maxSpeed, vF + k.accel * t * (1 - 0.55 * (vF / k.maxSpeed)) * dt)
    } else if (t < 0) {
      if (vF > 0.3) vF = Math.max(0, vF - k.brake * -t * dt)
      else vF = Math.max(-k.reverseSpeed, vF - k.accel * 0.6 * -t * dt)
    } else {
      vF *= Math.exp(-k.drag * dt)
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), 0.8 * dt)
    }
    // Jet-boosted speed bleeds back towards the electric top speed.
    if (vF > k.maxSpeed) vF -= (vF - k.maxSpeed) * 0.7 * dt
    vF += c.jets.rear * CONFIG.jets.rear * dt
    const st = c.jets.strafe ?? 0
    vL *= Math.exp(-k.grip * (st !== 0 ? 0.12 : 1) * dt)
    vL += st * CONFIG.jets.strafe * dt
    const s = Math.abs(vF)
    const factor = THREE.MathUtils.clamp(s / 8, 0, 1) * (1 - 0.45 * THREE.MathUtils.clamp((s - 8) / 24, 0, 1))
    const wantYaw = -THREE.MathUtils.clamp(c.steer, -1, 1) * k.turnRate * factor * (vF < -0.1 ? -1 : 1)
    this.yawRateG = THREE.MathUtils.damp(this.yawRateG, wantYaw, k.yawResponse, dt)
    const yawRate = this.yawRateG
    this.steerVisual = THREE.MathUtils.damp(this.steerVisual, c.steer, 10, dt)
    const nextYaw = yaw + yawRate * dt
    this.quat.setFromAxisAngle(UP, nextYaw)
    const nf = new THREE.Vector3(-Math.sin(nextYaw), 0, -Math.cos(nextYaw))
    const nr = new THREE.Vector3(Math.cos(nextYaw), 0, -Math.sin(nextYaw))
    this.vel.copy(nf).multiplyScalar(vF).addScaledVector(nr, vL)
    this.angVel.set(0, yawRate, 0)
    // In front of a loop the right lane is closed: ease the car over into the left lane.
    if (loopMergeAt(this.pos.z) >= 0 && this.pos.x > -1.9 && nf.z < -0.3) {
      this.vel.x = THREE.MathUtils.damp(this.vel.x, (-2.2 - this.pos.x) * 2.6, 7, dt)
    }
    const climb = c.jets.lift * CONFIG.jets.lift + k.gravity
    this.vel.y = climb > 0 ? climb * dt : 0
    if (this.vel.y > 0) this.grounded = false
    this.capSpeed()
  }

  private stepAir(dt: number, c: CarControls): void {
    const j = CONFIG.jets
    this.airTime += dt
    const up = this.up(new THREE.Vector3())
    const fwd = this.forward(new THREE.Vector3())
    this.vel.y += CONFIG.car.gravity * dt
    this.vel.addScaledVector(up, c.jets.lift * j.lift * dt)
    this.vel.addScaledVector(fwd, c.jets.rear * j.rear * dt)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat)
    this.vel.addScaledVector(right, (c.jets.strafe ?? 0) * j.strafe * dt)
    // Attitude control: W/S nudges along the heading, and horizontal velocity follows the nose.
    const fh = new THREE.Vector3(fwd.x, 0, fwd.z)
    if (fh.lengthSq() > 1e-4 && this.flipTimer <= 0) {
      fh.normalize()
      this.vel.addScaledVector(fh, THREE.MathUtils.clamp(c.throttle, -1, 1) * j.airThrottle * dt)
      const hs = Math.hypot(this.vel.x, this.vel.z)
      if (hs > 2 && (c.jets.strafe ?? 0) === 0 && this.vel.x * fh.x + this.vel.z * fh.z > 0) {
        const a = Math.atan2(this.vel.x, this.vel.z)
        let d = Math.atan2(fh.x, fh.z) - a
        d = Math.atan2(Math.sin(d), Math.cos(d))
        const na = a + THREE.MathUtils.clamp(d, -j.airAlign * dt, j.airAlign * dt)
        this.vel.x = hs * Math.sin(na)
        this.vel.z = hs * Math.cos(na)
      }
    }
    this.vel.multiplyScalar(Math.exp(-0.06 * dt))
    if (this.flipTimer > 0) {
      // Scripted roll after the ramp: pure rotation about the travel axis, then snap level.
      this.flipTimer -= dt
      const w = this.angVel.length()
      if (w > 1e-6) {
        tmpQ.setFromAxisAngle(tmpV.copy(this.angVel).divideScalar(w), w * Math.min(dt, dt + this.flipTimer))
        this.quat.premultiply(tmpQ).normalize()
      }
      if (this.flipTimer <= 0) {
        this.flipTimer = 0
        this.quat.setFromAxisAngle(UP, this.yaw)
        this.angVel.set(0, 0, 0)
      }
      this.capSpeed()
      return
    }
    // Arcade air steering: A/D always gives the full yaw rate (attitude jets, free), and the
    // horizontal velocity swings round with the nose (airAlign above), so turning the car in the
    // air really changes where it flies.
    const yawCmd = THREE.MathUtils.clamp(c.steer + c.jets.side, -1, 1)
    const yawNow = this.angVel.dot(up)
    this.angVel.addScaledVector(up, (-yawCmd * j.yawRate - yawNow) * (1 - Math.exp(-8 * dt)))
    // Stabilisation trim pulls the body back towards level (pitch/roll only) and damps spin.
    const err = new THREE.Vector3().crossVectors(up, UP)
    this.angVel.addScaledVector(err, j.trim * 3 * dt)
    const yawPart = up.clone().multiplyScalar(this.angVel.dot(up))
    const tilt = this.angVel.clone().sub(yawPart)
    tilt.multiplyScalar(Math.exp(-j.angularDamping * 2 * dt))
    yawPart.multiplyScalar(Math.exp(-j.angularDamping * 0.1 * dt))
    this.angVel.copy(tilt).add(yawPart)
    const w = this.angVel.length()
    if (w > 1e-6) {
      tmpQ.setFromAxisAngle(tmpV.copy(this.angVel).divideScalar(w), w * dt)
      this.quat.premultiply(tmpQ).normalize()
    }
    this.steerVisual = THREE.MathUtils.damp(this.steerVisual, 0, 4, dt)
    this.capSpeed()
  }

  private capSpeed(): void {
    const max = CONFIG.car.jetMaxSpeed
    const s = this.vel.length()
    if (s > max) this.vel.multiplyScalar(max / s)
  }

  /** Highest support under the car centre: terrain, deck, or the top of a solid box. */
  supportAt(x: number, z: number, y: number, solids: readonly Box[]): number {
    let g = groundAt(x, z, y)
    for (const b of solids) {
      if (b.kind === 'bounds' || b.solid === false) continue
      if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue
      if (b.max[1] <= y + 0.35 && b.max[1] > g) g = b.max[1]
    }
    return g
  }

  private resolveGround(dt: number, events: CarEvent[], solids: readonly Box[]): void {
    const g = this.supportAt(this.pos.x, this.pos.z, this.pos.y, solids)
    if (this.grounded) {
      if (this.pos.y - g > 0.45) {
        // Drove off an edge (trench, deck end, roof).
        this.grounded = false
        this.airTime = 0
        events.push({ type: 'takeoff' })
      } else {
        this.pos.y = g
        if (this.vel.y < 0) this.vel.y = 0
      }
      return
    }
    if (this.vel.y > 0 && this.airTime === 0) {
      events.push({ type: 'takeoff' })
    }
    if (this.pos.y <= g && this.vel.y <= 0) {
      const impact = -this.vel.y
      const upright = this.upright
      const landing = classifyLanding(impact, upright, this.airTime)
      events.push({ type: 'land', impact, landing, airTime: this.airTime, upright })
      this.pos.y = g
      this.vel.y = 0
      this.grounded = true
      this.airTime = 0
      const yaw = this.yaw
      this.quat.setFromAxisAngle(UP, yaw)
      this.angVel.set(0, 0, 0)
    } else if (this.airTime === 0) {
      // First airborne step; keep counting from here.
      this.airTime = dt * 0.5
    }
  }

  private collide(solids: readonly Box[], events: CarEvent[]): void {
    const yaw = this.yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const y0 = this.pos.y
    const y1 = this.pos.y + CAR.height
    for (const b of CEILINGS) {
      if (this.pos.x < b.min[0] || this.pos.x > b.max[0] || this.pos.z < b.min[2] || this.pos.z > b.max[2]) continue
      if (y1 > b.min[1] && y0 < b.min[1]) {
        this.pos.y = b.min[1] - CAR.height
        if (this.vel.y > 0) this.vel.y = 0
      }
    }
    let hit = 0
    let nSumX = 0
    let nSumZ = 0
    for (let pass = 0; pass < 2; pass += 1) {
      for (const side of [1, -1]) {
        const cx = this.pos.x + fx * CAR.axle * side
        const cz = this.pos.z + fz * CAR.axle * side
        for (const b of solids) {
          if (b.solid === false) continue
          if (b.max[1] <= y0 + 0.35 || b.min[1] >= y1) continue
          const r = CAR.radius
          if (cx < b.min[0] - r || cx > b.max[0] + r || cz < b.min[2] - r || cz > b.max[2] + r) continue
          const px = Math.max(b.min[0], Math.min(cx, b.max[0]))
          const pz = Math.max(b.min[2], Math.min(cz, b.max[2]))
          let nx = cx - px
          let nz = cz - pz
          let d = Math.hypot(nx, nz)
          let push: number
          if (d < 1e-5) {
            // Circle centre inside the box: leave through the nearest face.
            const opts = [
              [cx - b.min[0], -1, 0], [b.max[0] - cx, 1, 0], [cz - b.min[2], 0, -1], [b.max[2] - cz, 0, 1],
            ].sort((a, c) => a[0] - c[0])[0]
            nx = opts[1]
            nz = opts[2]
            push = opts[0] + r
            d = 1
          } else {
            if (d >= r) continue
            push = r - d
            nx /= d
            nz /= d
          }
          this.pos.x += nx * push
          this.pos.z += nz * push
          const vn = this.vel.x * nx + this.vel.z * nz
          if (vn < 0) {
            // Remove only the speed going into the surface (tiny bounce); keep the sliding speed.
            this.vel.x -= nx * vn * 1.08
            this.vel.z -= nz * vn * 1.08
            hit = Math.max(hit, -vn)
            nSumX += nx
            nSumZ += nz
          }
        }
      }
    }
    if (hit > 0) {
      const sp = Math.hypot(this.vel.x, this.vel.z)
      // A light scrub, once per step, scaled by how head-on the hit was (glancing hits keep their speed).
      const scrub = 1 - 0.18 * Math.min(1, hit / (sp + hit + 1e-3))
      this.vel.x *= scrub
      this.vel.z *= scrub
      // On the ground, swing the nose round to follow the wall so the car glides along it
      // instead of grinding into it (grip would otherwise drag it back into the wall).
      const nl = Math.hypot(nSumX, nSumZ)
      if (this.grounded && nl > 1e-4 && sp > 1.5) {
        const nxs = nSumX / nl
        const nzs = nSumZ / nl
        const fdn = fx * nxs + fz * nzs
        if (fdn < -0.02 && fdn > -0.97) {
          const tx = fx - nxs * fdn
          const tz = fz - nzs * fdn
          let d = Math.atan2(-tx, -tz) - yaw
          d = Math.atan2(Math.sin(d), Math.cos(d))
          this.quat.setFromAxisAngle(UP, yaw + d * 0.35)
        }
      }
    }
    if (hit > 3) events.push({ type: 'bump', strength: hit })
  }
}
