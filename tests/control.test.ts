import { describe, expect, it } from 'vitest'
import { Car } from '../src/game/car'
import { SPOT, inRect, Z } from '../src/game/course'

const dt = 1 / 60
const jets = (o: Partial<{ rear: number; lift: number; side: number; strafe: number }> = {}) => ({ rear: 0, lift: 0, side: 0, strafe: 0, ...o })

describe('controls', () => {
  it('Q/E strafes sideways on the ground', () => {
    const car = new Car()
    car.reset(0, 0, -20, 0)
    for (let i = 0; i < 40; i += 1) car.step(dt, { throttle: 0, steer: 0, jets: jets({ strafe: 1 }) }, [], [])
    expect(car.pos.x).toBeGreaterThan(1.5)
  })
  it('Q/E strafes sideways in the air while flying forward', () => {
    const car = new Car()
    car.reset(0, 0, -20, 0)
    car.pos.y = 20
    car.grounded = false
    car.vel.set(0, 0, -15)
    for (let i = 0; i < 30; i += 1) car.step(dt, { throttle: 0, steer: 0, jets: jets({ strafe: 1 }) }, [], [])
    expect(car.pos.x).toBeGreaterThan(1.5)
  })
  it('A/D turns the car in the air even without side-jet gas', () => {
    const car = new Car()
    car.reset(0, 0, -20, 0)
    car.pos.y = 12
    car.grounded = false
    const yaw0 = car.cameraYaw
    for (let i = 0; i < 30; i += 1) car.step(dt, { throttle: 0, steer: 1, jets: jets() }, [], [])
    expect(Math.abs(car.cameraYaw - yaw0)).toBeGreaterThan(0.5)
  })
  it('horizontal velocity follows the nose in the air', () => {
    const car = new Car()
    car.reset(0, 0, -20, 0)
    car.pos.y = 30
    car.grounded = false
    car.vel.set(0, 0, -20)
    for (let i = 0; i < 60; i += 1) car.step(dt, { throttle: 0, steer: 1, jets: jets({ side: 1 }) }, [], [])
    // Turning right (steer +1) swings travel towards +x.
    expect(Math.abs(car.vel.x)).toBeGreaterThan(5)
  })
  it('home is a wide apron across the end of the road', () => {
    expect(inRect(SPOT, 0, Z.end + 2)).toBe(true)
    expect(inRect(SPOT, -5, Z.end + 2)).toBe(true)
    expect(inRect(SPOT, 0, Z.homeZ0 + 30)).toBe(false)
  })
})
