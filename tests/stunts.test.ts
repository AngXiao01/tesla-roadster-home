import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Car, type CarEvent } from '../src/game/car'
import { LOOP_MERGE, LOOPS, WALLS, FLIP, FLYOVER } from '../src/game/course'
import { convoyBlocking, createConvoy, startConvoy, stepConvoy } from '../src/game/convoy'
const none = { rear: 0, lift: 0, side: 0 }
const upY = (car: Car) => new THREE.Vector3(0, 1, 0).applyQuaternion(car.quat).y

/** Drive at a loop from the right lane at `speed`, holding the throttle. */
function loopRun(i: number, speed: number, throttle = 1) {
  const l = LOOPS[i]
  const car = new Car()
  car.reset(1.8, 0, l.zEntry + l.radius + LOOP_MERGE + 8, 0)
  car.vel.set(0, 0, -speed)
  const events: CarEvent[] = []
  let minUp = 1
  let maxY = 0
  for (let k = 0; k < 60 * 12; k += 1) {
    car.step(1 / 60, { throttle, steer: 0, jets: none }, WALLS, events)
    minUp = Math.min(minUp, upY(car))
    maxY = Math.max(maxY, car.pos.y)
    if (events.some(e => e.type === 'loopDone') && car.pos.z < l.zEntry - 25) break
  }
  return { car, events, minUp, maxY }
}

describe('main-road loops', () => {
  for (const i of [0]) {
    it(`loop ${i + 1}: the right lane eases left, the car rides through inverted and exits right, heading on`, () => {
      const l = LOOPS[i]
      const r = loopRun(i, 18)
      expect(r.events.some(e => e.type === 'rampStart')).toBe(true)
      expect(r.events.some(e => e.type === 'loopDone')).toBe(true)
      expect(r.events.some(e => e.type === 'bump')).toBe(false)
      expect(r.minUp).toBeLessThan(-0.95)
      expect(r.maxY).toBeGreaterThan(l.radius * 2 - 0.2)
      expect(r.car.grounded).toBe(true)
      expect(r.car.pos.x).toBeGreaterThan(0)
      expect(r.car.pos.z).toBeLessThan(l.zEntry - 20)
      expect(upY(r.car)).toBeGreaterThan(0.99)
      expect(r.car.forward().z).toBeLessThan(-0.99)
    })
  }
  it('the boost strip tops up a slow car so it still makes it round', () => {
    const r = loopRun(0, 4, 0.3)
    expect(r.events.some(e => e.type === 'loopDone')).toBe(true)
    expect(r.events.some(e => e.type === 'rampFail')).toBe(false)
  })
})

describe('Roadster flip', () => {
  it('right lane eases left, spirals up the curl, leaves inverted, rolls upright and lands past the trucks', () => {
    const car = new Car()
    car.reset(1.8, 0, FLIP.zStart + 30, 0)
    const events: CarEvent[] = []
    let minUp = 1
    let maxY = 0
    let launched = false
    for (let k = 0; k < 60 * 10; k += 1) {
      car.step(1 / 60, { throttle: 1, steer: 0, jets: none }, WALLS, events)
      minUp = Math.min(minUp, upY(car))
      maxY = Math.max(maxY, car.pos.y)
      if (events.some(e => e.type === 'flipLaunch')) launched = true
      if (launched && car.grounded) break
    }
    expect(events.some(e => e.type === 'rampStart')).toBe(true)
    expect(launched).toBe(true)
    expect(events.some(e => e.type === 'bump')).toBe(false)
    expect(minUp).toBeLessThan(-0.95)
    expect(maxY).toBeGreaterThan(FLIP.radius * 2 - 1.5)
    expect(car.grounded).toBe(true)
    expect(upY(car)).toBeGreaterThan(0.99)
    expect(car.forward().z).toBeLessThan(-0.99)
    const last = FLYOVER[FLYOVER.length - 1]
    expect(car.pos.z).toBeLessThan(last.z - last.length / 2)
  })
})
describe('wall contact', () => {
  it('a glancing hit on a wall keeps most of the speed and turns the nose along it', () => {
    // Lot hedge, not a roadside barrier: those no longer collide.
    const car = new Car()
    car.reset(21, 0, 8, 0)
    car.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.35)
    car.vel.set(Math.sin(0.35) * 20, 0, -Math.cos(0.35) * 20)
    const events: CarEvent[] = []
    for (let k = 0; k < 60; k += 1) car.step(1 / 60, { throttle: 1, steer: 0, jets: none }, WALLS, events)
    expect(car.speed).toBeGreaterThan(15)
    expect(Math.abs(car.forward().x)).toBeLessThan(0.15)
  })
})
describe('air steering', () => {
  it('A/D in the air turns the direction of travel, not just the nose', () => {
    const car = new Car()
    car.reset(0, 20, -100, 0)
    car.grounded = false
    car.vel.set(0, 0, -20)
    const events: CarEvent[] = []
    for (let k = 0; k < 60; k += 1) car.step(1 / 60, { throttle: 0, steer: 1, jets: none }, [], events)
    const heading = Math.atan2(car.vel.x, -car.vel.z)
    expect(heading).toBeGreaterThan(1.2)
    expect(Math.hypot(car.vel.x, car.vel.z)).toBeGreaterThan(17)
  })
})

describe('truck convoy', () => {
  it('blocks the crossing for a while and then clears', () => {
    let c = startConvoy(createConvoy())
    let blocked = 0
    let clearAfter = -1
    for (let t = 0; t < 60; t += 0.1) {
      c = stepConvoy(c, 0.1)
      if (convoyBlocking(c)) blocked += 0.1
      else if (blocked > 0 && clearAfter < 0) clearAfter = t
    }
    expect(blocked).toBeGreaterThan(6)
    expect(clearAfter).toBeGreaterThan(0)
    expect(clearAfter).toBeLessThan(25)
  })
})
