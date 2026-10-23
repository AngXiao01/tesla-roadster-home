// Browser smoke test: boots the game in headless Chromium, drives through key scenes using the
// debug hook, saves screenshots to /tmp/homejet-shots and fails on console errors.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const URL = process.env.URL ?? 'http://localhost:3000/'
const OUT = '/tmp/homejet-shots'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
const wait = ms => page.waitForTimeout(ms)
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` })
const state = () => page.evaluate(() => {
  const { game } = window.__game
  const c = game.car
  return { mode: game.mode, x: +c.pos.x.toFixed(2), y: +c.pos.y.toFixed(2), z: +c.pos.z.toFixed(2), grounded: c.grounded, gas: +game.gasLevel.toFixed(1), crossing: game.crossingState.phase, safe: game.safeIndex, run: game.run, model: game.view.modelLoaded }
})
const teleport = (x, y, z, yaw = 0) => page.evaluate(([x, y, z, yaw]) => window.__game.game.debugTeleport(x, y, z, yaw), [x, y, z, yaw])

// Direct dev-port requests bypass the Preview storage resolver; serve the registered model locally.
if (!process.env.URL) await page.route('**/manus-storage/game/sha256/*.glb', r => r.fulfill({ path: 'assets/models/jet-roadster.glb', contentType: 'model/gltf-binary' }))
await page.goto(URL)
await page.waitForFunction(() => window.__game && document.querySelector('#ui').dataset.activeScreen === 'title', null, { timeout: 60000 })
await wait(800)
await shot('01-title')
await page.click('[data-action="play"]')
await wait(300)
const coachNo = () => page.evaluate(() => { const el = document.querySelector('.coach'); return el.classList.contains('is-hidden') ? 'hidden' : el.querySelector('.coach-no').textContent })
if (await coachNo() !== '01') errors.push('first-run coach should start at step 01, got ' + await coachNo())
await shot('01b-coach')
await page.keyboard.down('KeyW')
await wait(2500)
await page.waitForFunction(() => document.querySelector('.coach-no').textContent === '02', null, { timeout: 8000 }).catch(() => {})
await page.keyboard.up('KeyW')
console.log('after drive', await state(), 'coach', await coachNo())
if (await coachNo() !== '02') errors.push('coach should advance to 02 (Space) after driving, got ' + await coachNo())
await shot('02-drive')
// Rear jet + lift on the open road.
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await wait(600)
await page.keyboard.down('Space'); await wait(700)
await shot('03-jets')
console.log('coach after lift', await coachNo())
{ const j = await state(); console.log('jets', j); if (j.gas < 99.9) errors.push('lot gas should be unlimited, got ' + j.gas) }
await page.keyboard.up('Space'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW')
// Lateral jets: hold E in the air.
await page.keyboard.down('KeyE'); await wait(500)
await shot('03b-strafe')
{ const st = await state(); console.log('strafe', st); if (st.x < 0.5) errors.push('E did not strafe right: x=' + st.x) }
await page.keyboard.up('KeyE')
await wait(2500)
console.log('landed', await state())
// Jam tail.
await teleport(-1.8, 0, -165)
await wait(1500)
await shot('04-jam')
// Wedged against the left wall with W held: the car must hop free, not stay stuck.
await teleport(-4.6, 0, -100, Math.PI / 2)
await wait(200)
await page.keyboard.down('KeyW')
await page.waitForFunction(() => !window.__game.game.car.grounded, null, { timeout: 4000 }).catch(() => errors.push('car stayed stuck against the wall'))
await page.keyboard.up('KeyW')
console.log('unstuck', await state())
await wait(1500)
// Loop 1: approach in the right lane; the lane guide moves the car left, it rides round inverted and exits right.
await teleport(1.8, 0, -628)
await page.keyboard.down('KeyW')
await page.waitForFunction(() => window.__game.game.car.ramp && window.__game.game.car.ramp.theta > Math.PI * 0.85, null, { timeout: 12000 }).catch(() => errors.push('loop 1: never reached the inverted top'))
await shot('05-loop1-top')
await page.waitForFunction(() => window.__game.game.run.loops >= 1, null, { timeout: 12000 }).catch(() => errors.push('loop 1: never completed'))
await wait(350)
await shot('05-loop1-exit')
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')
{ const t = await page.evaluate(() => { const c = window.__game.game.car; return { x: c.pos.x, z: c.pos.z, grounded: c.grounded, up: c.upright, loops: window.__game.game.run.loops, resets: window.__game.game.run.resets } }); console.log('loop 1', t); if (!t.grounded || t.up < 0.95 || t.x < 0) errors.push('loop 1: bad exit ' + JSON.stringify(t)) }
await wait(800)
// Railway: trigger and wait at the stop line.
await teleport(1.8, 0, -310)
await wait(6500)
await shot('06-rail-closed')
console.log('rail', await state())
await wait(5000)
await shot('07-train')
// Crossing during closure should reset.
await teleport(1.8, 0, -339)
await wait(300)
console.log('rail violation', await state())
// Train hit: park on the track while a train passes; expect a shove, never a reset.
await page.waitForFunction(() => window.__game.game.crossingState.phase === 'train', null, { timeout: 30000 }).catch(() => {})
await teleport(1.8, 0, -340)
await page.waitForFunction(() => Math.abs(window.__game.game.car.pos.z + 340) > 1.5 || !window.__game.game.car.grounded, null, { timeout: 15000 }).catch(() => errors.push('train never reached the parked car'))
await wait(400)
{ const t = await state(); console.log('train hit', t); if (t.mode !== 'playing' || t.run.resets !== 0) errors.push('train hit caused reset/end'); if (Math.abs(t.x - 1.8) > 6) errors.push('car was dragged along by the train: x=' + t.x) }
await shot('07b-train-hit')
// Truck convoy crossing.
await teleport(1.8, 0, -398)
await wait(3200)
await shot('09-convoy')
console.log('convoy', await state())
// Roadster flip: right lane eases left, spirals up the curl, leaves inverted, rolls upright over the trucks.
await teleport(1.8, 0, -684)
await page.keyboard.down('KeyW')
await page.waitForFunction(() => { const r = window.__game.game.car.ramp; return r && r.kind === 'flip' && r.theta > 0.8 }, null, { timeout: 12000 }).catch(() => errors.push('flip: never reached the inverted lip'))
await shot('10-flip-top')
await page.waitForFunction(() => window.__game.game.run.flips >= 1, null, { timeout: 12000 }).catch(() => errors.push('flip: never launched'))
await wait(450)
await shot('10-flip-air')
await page.waitForFunction(() => window.__game.game.car.grounded && !window.__game.game.car.ramp, null, { timeout: 8000 }).catch(() => errors.push('flip: never landed'))
await page.keyboard.up('KeyW')
{ const t = await page.evaluate(() => { const c = window.__game.game.car; return { x: c.pos.x, z: c.pos.z, up: c.upright, resets: window.__game.game.run.resets } }); console.log('flip', t); if (t.up < 0.95 || t.z > -764 || t.resets) errors.push('flip: bad landing ' + JSON.stringify(t)) }
await wait(800)
// Air steering: airborne with W held, D must swing the direction of travel round.
await teleport(0, 24, -600)
await page.keyboard.down('KeyW'); await page.keyboard.down('Space')
await wait(1500)
const h0 = await page.evaluate(() => { const v = window.__game.game.car.vel; return Math.atan2(v.x, -v.z) })
await page.keyboard.down('KeyD')
await page.waitForFunction(() => Math.abs(window.__game.game.car.yaw) > 1.2, null, { timeout: 8000 }).catch(() => {})
await wait(300)
const h1 = await page.evaluate(() => { const v = window.__game.game.car.vel; return { h: Math.atan2(v.x, -v.z), s: Math.hypot(v.x, v.z) } })
await shot('12-air-turn')
await page.keyboard.up('KeyD'); await page.keyboard.up('Space'); await page.keyboard.up('KeyW')
console.log('air turn', h0, h1)
if (Math.abs(h1.h - h0) < 0.5 || h1.s < 4) errors.push('air steering did not turn the travel direction: ' + JSON.stringify({ h0, h1 }))
await wait(1500)
// Residential + home parking.
await teleport(0, 0, -540)
await wait(800)
await shot('13-residential')
// Drive straight down the road: reaching the house at the end finishes, no parking needed.
await page.keyboard.down('KeyW')
await page.waitForFunction(() => window.__game.game.mode === 'ended', null, { timeout: 60000 }).catch(() => errors.push('driving to the house did not finish the trip'))
await page.keyboard.up('KeyW')
await shot('14-home')
await wait(1500)
await shot('15-results')
// Second run: flying high over the house roof must also count as home (no getting stuck behind it).
await page.click('.screen-results [data-action="restart"]')
await wait(500)
if (await coachNo() !== 'hidden') errors.push('coach should not reappear after it was completed or skipped')
await teleport(0, 16, -796)
await page.keyboard.down('KeyW'); await page.keyboard.down('Space')
await page.waitForFunction(() => window.__game.game.mode === 'ended', null, { timeout: 10000 }).catch(() => errors.push('flying over the house did not finish the trip'))
await page.keyboard.up('Space'); await page.keyboard.up('KeyW')
console.log('fly-over home', await state())
// Third run: off-road through the side field also finishes.
await page.click('.screen-results [data-action="restart"]')
await wait(500)
await teleport(30, 0, -790)
await page.keyboard.down('KeyW')
await page.waitForFunction(() => window.__game.game.mode === 'ended', null, { timeout: 15000 }).catch(() => errors.push('off-road arrival did not finish the trip'))
await page.keyboard.up('KeyW')
console.log('off-road home', await state())
await shot('15-results')
{ const h = await state(); console.log('home', h); if (h.run.resets !== 0) errors.push('forced resets happened: ' + h.run.resets) }
console.log('ERRORS', JSON.stringify(errors))
await browser.close()
if (errors.length) process.exit(1)
