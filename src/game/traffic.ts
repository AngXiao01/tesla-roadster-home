import * as THREE from 'three'
import { CONFIG } from './config'
import { LANES, Z, type Box } from './course'
import { trafficLight, type Light } from './rules'

/**
 * A finite traffic jam: two lanes of queued cars in front of a light at the stop line. Cars
 * follow a simple gap/headway model, cross on green, then turn left into a side road and leave.
 * This is deliberately not traffic AI: a stop-and-go queue that the player can wait out.
 */
export type JamCar = { lane: number; s: number; v: number; gone: boolean; hue: number }

const PER_LANE = 10
const LENGTH = 4.4
/** Each lane: straight to its turn point, then a quarter circle to the left, then straight -X. */
const TURN = [
  { z: -261, r: 4.5 },
  { z: -265, r: 9 },
]
const EXIT_X = -58

export function lanePath(lane: number, s: number, out = { x: 0, z: 0, yaw: 0 }): { x: number; z: number; yaw: number } {
  const x0 = LANES[lane]
  const t = TURN[lane]
  const straight = Z.jamTail + 4 - t.z // length of the first straight (from s = 0)
  const zStart = Z.jamTail + 4
  if (s <= straight) {
    out.x = x0
    out.z = zStart - s
    out.yaw = 0
    return out
  }
  const arc = (Math.PI / 2) * t.r
  if (s <= straight + arc) {
    const th = (s - straight) / t.r
    const cx = x0 - t.r
    out.x = cx + t.r * Math.cos(th)
    out.z = t.z - t.r * Math.sin(th)
    out.yaw = th
    return out
  }
  out.x = x0 - t.r - (s - straight - arc)
  out.z = t.z - t.r
  out.yaw = Math.PI / 2
  return out
}

/** Path length at which the front bumper reaches the stop line. */
export function stopS(): number {
  return Z.jamTail + 4 - Z.stopLine - LENGTH / 2 - 0.5
}

export function exitS(lane: number): number {
  const t = TURN[lane]
  const straight = Z.jamTail + 4 - t.z
  return straight + (Math.PI / 2) * t.r + (LANES[lane] - t.r - EXIT_X)
}

export function createJam(): JamCar[] {
  const cars: JamCar[] = []
  const spacing = LENGTH + CONFIG.traffic.gap
  for (let lane = 0; lane < 2; lane += 1) {
    for (let i = 0; i < PER_LANE; i += 1) {
      const s = stopS() - i * spacing - (lane ? 1.2 : 0)
      cars.push({ lane, s, v: 0, gone: false, hue: (i * 67 + lane * 31) % 360 })
    }
  }
  return cars
}

/**
 * Advance the queue. `player` (if in a lane ahead of a car) acts as a leader so cars never drive
 * through the player. Returns the light state used.
 */
export function stepJam(cars: JamCar[], time: number, dt: number, player: { x: number; z: number } | null): Light {
  const tr = CONFIG.traffic
  const light = trafficLight(time)
  const stop = stopS()
  const p = { x: 0, z: 0, yaw: 0 }
  for (let lane = 0; lane < 2; lane += 1) {
    const queue = cars.filter(c => c.lane === lane && !c.gone).sort((a, b) => b.s - a.s)
    let leaderS = Infinity
    let leaderV = 0
    for (const car of queue) {
      let gapAvail = leaderS - car.s - LENGTH
      let lv = leaderV
      // Red light: the stop line is a stationary leader for cars that can still stop for it.
      if (light === 'red' && car.s <= stop + 0.05) {
        const toLine = stop - car.s
        if (toLine >= -0.05 && toLine < gapAvail + LENGTH) {
          gapAvail = toLine + LENGTH * 0 + tr.gap
          lv = 0
        }
      }
      // The player inside this lane, ahead of the car, also counts as a leader.
      if (player) {
        lanePath(lane, car.s, p)
        if (p.yaw === 0 && Math.abs(player.x - p.x) < 2.2 && player.z < p.z && p.z - player.z < 40) {
          const g = p.z - player.z - LENGTH
          if (g < gapAvail) {
            gapAvail = g
            lv = 0
          }
        }
      }
      const want = car.s > stop ? tr.cruise * 1.35 : tr.cruise
      const safe = Math.sqrt(Math.max(0, 2 * tr.decel * Math.max(0, gapAvail - tr.gap))) + lv * 0.5
      const target = Math.min(want, safe, Math.max(0, (gapAvail - tr.gap) / tr.headway + lv))
      if (car.v < target) car.v = Math.min(target, car.v + tr.accel * dt)
      else car.v = Math.max(target, car.v - tr.decel * 2 * dt)
      if (gapAvail <= tr.gap * 0.5) car.v = 0
      car.s += car.v * dt
      if (car.s >= exitS(lane)) car.gone = true
      leaderS = car.s
      leaderV = car.v
    }
  }
  return light
}

/** Collision boxes for the remaining cars (axis-aligned, swapped while turning). */
export function jamBoxes(cars: JamCar[], out: Box[]): void {
  const p = { x: 0, z: 0, yaw: 0 }
  for (const c of cars) {
    if (c.gone) continue
    lanePath(c.lane, c.s, p)
    const along = Math.abs(Math.cos(p.yaw)) > 0.7
    const hx = along ? 1.0 : 2.2
    const hz = along ? 2.2 : 1.0
    out.push({ min: [p.x - hx, 0, p.z - hz], max: [p.x + hx, 1.5, p.z + hz], kind: 'wall' })
  }
}

/** Instanced low-poly traffic: body + cabin per car, brake lights on red. */
export class JamView {
  readonly group = new THREE.Group()
  private readonly body: THREE.InstancedMesh
  private readonly cabin: THREE.InstancedMesh
  private readonly lights: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()

  constructor(count: number) {
    const bodyGeo = new THREE.BoxGeometry(1.9, 0.7, 4.3)
    bodyGeo.translate(0, 0.55, 0)
    const cabGeo = new THREE.BoxGeometry(1.6, 0.55, 2.2)
    cabGeo.translate(0, 1.15, 0.2)
    const lightGeo = new THREE.BoxGeometry(1.6, 0.16, 0.08)
    lightGeo.translate(0, 0.75, 2.17)
    this.body = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 }), count)
    this.cabin = new THREE.InstancedMesh(cabGeo, new THREE.MeshStandardMaterial({ color: '#1c2433', roughness: 0.3, metalness: 0.2 }), count)
    this.lights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }), count)
    for (const m of [this.body, this.cabin, this.lights]) {
      m.castShadow = m !== this.lights
      m.frustumCulled = false
      this.group.add(m)
    }
  }

  update(cars: JamCar[], light: Light, time: number): void {
    const p = { x: 0, z: 0, yaw: 0 }
    let n = 0
    for (const c of cars) {
      if (c.gone) continue
      lanePath(c.lane, c.s, p)
      this.dummy.position.set(p.x, 0, p.z)
      this.dummy.rotation.set(0, p.yaw, 0)
      this.dummy.scale.setScalar(1)
      this.dummy.updateMatrix()
      this.body.setMatrixAt(n, this.dummy.matrix)
      this.cabin.setMatrixAt(n, this.dummy.matrix)
      const braking = c.v < 0.5 || light === 'red'
      this.dummy.scale.set(1, braking ? 1 : 0.0001, 1)
      this.dummy.updateMatrix()
      this.lights.setMatrixAt(n, this.dummy.matrix)
      this.body.setColorAt(n, this.color.setHSL(c.hue / 360, 0.45, 0.55 + 0.04 * Math.sin(time + c.hue)))
      n += 1
    }
    for (const m of [this.body, this.cabin, this.lights]) {
      m.count = n
      m.instanceMatrix.needsUpdate = true
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true
  }
}
