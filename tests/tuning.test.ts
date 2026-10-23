import { afterEach, describe, expect, it } from 'vitest'
import zh from '../src/i18n/zh-CN.json'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))
afterEach(() => {
  tuning.apply(defaults)
  tuning.activate('run')
})

describe('tuning', () => {
  it('validates whole patches and never mutates source defaults', () => {
    const before = tuning.read()
    for (const patch of [{ 'car.maxSpeed': 20, 'camera.fov': 999 }, { 'jets.lift': 17, 'car.gravity': -20 }, { unknown: 1 }, { 'car.maxSpeed': '20' }]) {
      expect(() => tuning.apply(patch)).toThrow()
      expect(tuning.read()).toEqual(before)
    }
    tuning.apply({ 'car.maxSpeed': 30 })
    expect(CONFIG.car.maxSpeed).toBe(30)
    expect(DEFAULT_CONFIG.car.maxSpeed).toBe(24)
  })
  it('keeps next-run values pending and latches unranked for gameplay changes', () => {
    tuning.activate('run')
    tuning.apply({ 'rail.trainSpeed': 20 })
    expect(CONFIG.rail.trainSpeed).toBe(DEFAULT_CONFIG.rail.trainSpeed)
    tuning.activate('run')
    expect(CONFIG.rail.trainSpeed).toBe(20)
    expect(tuning.unranked).toBe(true)
    tuning.apply(defaults)
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
    tuning.apply({ 'camera.fov': 80 })
    expect(tuning.unranked).toBe(false)
  })
})

describe('i18n', () => {
  it('has every zone title and hint', () => {
    const d = zh as Record<string, string>
    for (const z of ['lot', 'road', 'jam', 'railApproach', 'convoy', 'residential', 'stunt', 'flip', 'home']) {
      expect(d[`zone.${z}`]).toBeTruthy()
      expect(d[`zone.${z}.hint`]).toBeTruthy()
    }
    for (const p of ['open', 'warning', 'closed', 'train', 'clearing', 'opening']) expect(d[`hud.rail.${p}`]).toBeTruthy()
  })
})
