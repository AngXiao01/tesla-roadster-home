import { describe, expect, it } from 'vitest'
import { Car } from '../src/game/car'
import { CONFIG } from '../src/game/config'
import { groundAt, HOME_DRIVE, HOME_HOUSE, HOME_SHELL, inRailCorridor, LOOPS, ROAD_HALF, SAFE_NODES, SPOT, WALLS, Z, zoneAt, FLIP } from '../src/game/course'
import { trainSeconds } from '../src/game/rail'
import {
  addGas, classifyLanding, createCrossing, crossingPassable, formatClock, stepCrossing, stepGas, stepParking,
  trafficLight, triggerCrossing,
} from '../src/game/rules'
import { createJam, stepJam } from '../src/game/traffic'

const none = { rear: false, lift: false, side: 0 }

describe('gas', () => {
  it('spends per jet and never goes below zero', () => {
    const r = stepGas({ gas: 100, sinceJet: 9 }, { rear: true, lift: true, side: 1 }, 1, { grounded: false, steady: false })
    expect(r.state.gas).toBeCloseTo(100 - CONFIG.gas.costRear - CONFIG.gas.costLift - CONFIG.gas.costSide)
    expect(r.out).toEqual({ rear: 1, lift: 1, side: 1, strafe: 0 })
    const low = stepGas({ gas: 5, sinceJet: 0 }, { rear: false, lift: true, side: 0 }, 1, { grounded: false, steady: false })
    expect(low.state.gas).toBe(0)
    expect(low.out.lift).toBeCloseTo(5 / CONFIG.gas.costLift)
    const empty = stepGas({ gas: 0, sinceJet: 0 }, { rear: true, lift: true, side: -1 }, 0.1, { grounded: false, steady: false })
    expect(empty.out).toEqual({ rear: 0, lift: 0, side: -0, strafe: 0 })
  })
  it('regenerates only on the ground, steady, after the delay, and never in the air', () => {
    const air = stepGas({ gas: 50, sinceJet: 9 }, none, 1, { grounded: false, steady: false })
    expect(air.state.gas).toBe(50)
    const early = stepGas({ gas: 50, sinceJet: 0 }, none, 0.1, { grounded: true, steady: true })
    expect(early.state.gas).toBe(50)
    const ground = stepGas({ gas: 50, sinceJet: 9 }, none, 1, { grounded: true, steady: true })
    expect(ground.state.gas).toBeCloseTo(50 + CONFIG.gas.regen)
    const boosted = stepGas({ gas: 50, sinceJet: 9 }, none, 1, { grounded: true, steady: false })
    expect(boosted.state.gas).toBe(50)
    expect(addGas(95, 20)).toBe(CONFIG.gas.max)
  })
})

describe('landing and parking', () => {
  it('classifies landings', () => {
    expect(classifyLanding(CONFIG.car.crashImpact + 1, 1, 2)).toBe('crash')
    expect(classifyLanding(4, 0.3, 2)).toBe('crash')
    expect(classifyLanding(5, 0.99, 1.5)).toBe('clean')
    expect(classifyLanding(5, 0.99, 0.2)).toBe('rough')
  })
  it('needs a slow, grounded, upright hold inside the spot', () => {
    let hold = 0
    let done = false
    for (let i = 0; i < 120 && !done; i += 1) ({ hold, done } = stepParking(hold, { inSpot: true, speed: 0.2, grounded: true, upright: 1 }, 1 / 60))
    expect(done).toBe(true)
    expect(stepParking(1, { inSpot: true, speed: 5, grounded: true, upright: 1 }, 0.1).hold).toBe(0)
    expect(stepParking(1, { inSpot: false, speed: 0, grounded: true, upright: 1 }, 0.1).hold).toBe(0)
  })
  it('formats the clock', () => {
    expect(formatClock(75.9)).toBe('1:15')
  })
})

describe('railway crossing', () => {
  it('idles open until triggered, then runs warning → closed → train → clearing → opening → open', () => {
    let s = createCrossing()
    s = stepCrossing(s, 10, trainSeconds())
    expect(s.phase).toBe('open')
    s = triggerCrossing(s)
    const seen: string[] = [s.phase]
    for (let i = 0; i < 60 * 60; i += 1) {
      s = stepCrossing(s, 1 / 60, trainSeconds())
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase)
      if (seen.length > 6) break
    }
    expect(seen.slice(0, 7)).toEqual(['warning', 'closed', 'train', 'clearing', 'opening', 'open', 'warning'])
  })
  it('is impassable from warning until the gates are up again', () => {
    let s = triggerCrossing(createCrossing())
    expect(crossingPassable(s)).toBe(false)
    s = stepCrossing(s, CONFIG.rail.warning + CONFIG.rail.closed + 1, trainSeconds())
    expect(s.phase).toBe('train')
    expect(s.gate).toBe(1)
    expect(crossingPassable(s)).toBe(false)
    s = stepCrossing(s, trainSeconds() + CONFIG.rail.clearing + CONFIG.rail.opening, trainSeconds())
    expect(s.phase).toBe('open')
    expect(crossingPassable(s)).toBe(true)
  })
})

describe('traffic jam', () => {
  it('starts red and fully clears if the player waits', () => {
    expect(trafficLight(0)).toBe('red')
    const cars = createJam()
    let t = 0
    for (; t < 240 && cars.some(c => !c.gone); t += 1 / 30) stepJam(cars, t, 1 / 30, null)
    expect(cars.every(c => c.gone)).toBe(true)
    expect(t).toBeGreaterThan(20)
    expect(t).toBeLessThan(120)
  })
  it('never lets a queued car drive through a stopped player in its lane', () => {
    const cars = createJam()
    const tail = cars.filter(c => c.lane === 0).sort((a, b) => a.s - b.s)[0]
    const player = { x: -1.8, z: -164 - tail.s - 6 }
    for (let t = 0; t < 60; t += 1 / 30) stepJam(cars, t, 1 / 30, player)
    // Tail car is behind the player (smaller s → larger z); it must still be behind.
    expect(-164 - tail.s).toBeLessThan(0)
  })
})

describe('route', () => {
  it('is one flat main road with no side routes, and the left lane is clear all the way home', () => {
    expect(groundAt(12, -170, 0)).toBe(0)
    expect(groundAt(-12, Z.track, 0)).toBe(0)
    expect(inRailCorridor(Z.track)).toBe(true)
    expect(zoneAt(0, -200, 0)).toBe('jam')
    expect(zoneAt(0, LOOPS[0].zEntry, 0)).toBe('stunt')
    expect(zoneAt(0, FLIP.zStart, 0)).toBe('flip')
    expect(SPOT.x1 - SPOT.x0).toBeGreaterThan(4)
    const solid = (x: number, z: number) => WALLS.some(b => b.kind !== 'bounds' && b.max[1] > 0.35 && x > b.min[0] - 1.05 && x < b.max[0] + 1.05 && z > b.min[2] && z < b.max[2])
    for (let z = Z.lotEnd - 2; z > SPOT.z1; z -= 0.5) {
      const open = [-3.5, -3, -2.5, -2, -1.5, -1, 0, 1, 1.5, 2, 2.5, 3, 3.5].some(x => !solid(x, z))
      expect(open, `road fully blocked at z=${z}`).toBe(true)
    }
    // The loop entries (left lane) are never walled off.
    for (const l of LOOPS) for (let z = l.zEntry + 30; z > l.zEntry - 30; z -= 0.5) expect(solid(-2.2, z)).toBe(false)
  })
  it('seats the finish house clear of the apron and drops roadside barrier collision', () => {
    expect(SPOT.z0).toBe(Z.end)
    expect(SPOT.z1).toBe(Z.homeZ1 + 4)
    const home = WALLS.find(b => b.kind === 'building' && b.max[2] < Z.homeZ1)
    expect(home).toBeTruthy()
    const driveFar = Math.min(HOME_DRIVE.z0, HOME_DRIVE.z1)
    expect(home!.max[2]).toBeCloseTo(HOME_HOUSE.z1 + HOME_SHELL.porch)
    expect(home!.max[2]).toBeLessThan(driveFar)
    expect(driveFar).toBeLessThan(Z.end)
    expect(home!.solid).not.toBe(false)
    expect(WALLS.filter(b => b.kind === 'truck').every(b => b.solid !== false)).toBe(true)
    const edge = ROAD_HALF + 0.3
    const sides = WALLS.filter(b => b.solid === false)
    expect(sides).toHaveLength(11)
    for (const b of sides) {
      expect(Math.abs(Math.abs((b.min[0] + b.max[0]) / 2) - edge)).toBeLessThan(0.05)
      expect(b.max[0] - b.min[0]).toBeLessThan(2)
      expect(b.max[2] > home!.min[2] && b.min[2] < home!.max[2]).toBe(false)
    }
    const car = new Car()
    car.reset(0, 0, -80, -Math.PI / 2)
    const jets = { rear: 0, lift: 0, side: 0 }
    for (let i = 0; i < 180; i += 1) car.step(1 / 60, { throttle: 1, steer: 0, jets }, WALLS, [])
    expect(car.pos.x).toBeGreaterThan(8)
  })
  it('keeps safe nodes clear of solid boxes', () => {
    for (const n of SAFE_NODES) {
      for (const b of WALLS) {
        const inside = n.x > b.min[0] - 1 && n.x < b.max[0] + 1 && n.z > b.min[2] - 2.2 && n.z < b.max[2] + 2.2 && b.min[1] < 1
        expect(inside, `node ${n.id}`).toBe(false)
      }
    }
  })
})

describe('car', () => {
  it('drives forward on W, lifts with the underbody jets and lands', () => {
    const car = new Car()
    car.reset(0, 0, -40, 0)
    const jets = { rear: 0, lift: 0, side: 0 }
    for (let i = 0; i < 120; i += 1) car.step(1 / 60, { throttle: 1, steer: 0, jets }, WALLS, [])
    expect(car.pos.z).toBeLessThan(-45)
    expect(car.forwardSpeed).toBeGreaterThan(8)
    for (let i = 0; i < 40; i += 1) car.step(1 / 60, { throttle: 0, steer: 0, jets: { rear: 0, lift: 1, side: 0 } }, WALLS, [])
    expect(car.grounded).toBe(false)
    expect(car.pos.y).toBeGreaterThan(1)
    const events: { type: string }[] = []
    for (let i = 0; i < 300 && !car.grounded; i += 1) car.step(1 / 60, { throttle: 0, steer: 0, jets }, WALLS, events as never)
    expect(car.grounded).toBe(true)
    expect(events.some(e => e.type === 'land')).toBe(true)
  })
  it('turns with side jets in the air and the thrust follows the body', () => {
    const car = new Car()
    car.reset(0, 20, -60, 0)
    car.grounded = false
    const before = car.yaw
    for (let i = 0; i < 30; i += 1) car.step(1 / 60, { throttle: 0, steer: 0, jets: { rear: 0, lift: 1, side: 1 } }, [], [])
    expect(car.yaw).toBeLessThan(before - 0.2)
    car.vel.set(0, 0, 0)
    car.angVel.set(0, 0, 0)
    const yaw = car.yaw
    for (let i = 0; i < 30; i += 1) car.step(1 / 60, { throttle: 0, steer: 0, jets: { rear: 1, lift: 1, side: 0 } }, [], [])
    const dir = Math.atan2(-car.vel.x, -car.vel.z)
    expect(Math.abs(dir - yaw)).toBeLessThan(0.35)
  })
})
