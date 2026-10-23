import * as THREE from 'three'
import { ROAD_HALF, Z, type Box } from './course'

/**
 * A convoy of electric semis and wedge pickups crossing the route on a side road. It cycles on its
 * own clock once the player approaches: the crossing is blocked while the convoy passes, then free
 * for a while. Waiting it out is always possible; hopping over it on the jets is allowed.
 */
export type ConvoyKind = 'semi' | 'pickup'
type Spec = { kind: ConvoyKind; length: number; height: number; width: number }
const SPEC: Record<ConvoyKind, Spec> = {
  semi: { kind: 'semi', length: 17, height: 4.1, width: 2.6 },
  pickup: { kind: 'pickup', length: 5.8, height: 1.95, width: 2.2 },
}
const ORDER: ConvoyKind[] = ['semi', 'pickup', 'pickup', 'semi', 'pickup', 'semi']
const GAP = 3.2
export const CONVOY_SPEED = 9
const RUN_FROM = -95
const RUN_TO = 95
/** Free road between convoys, in metres of convoy travel. */
const PAUSE = 95

type Slot = { spec: Spec; offset: number }
export const SLOTS: Slot[] = (() => {
  let off = 0
  return ORDER.map(k => {
    const s = { spec: SPEC[k], offset: off }
    off += SPEC[k].length + GAP
    return s
  })
})()
export const CONVOY_LENGTH = SLOTS[SLOTS.length - 1].offset + SLOTS[SLOTS.length - 1].spec.length
const CYCLE = RUN_TO - RUN_FROM + CONVOY_LENGTH + PAUSE

export type ConvoyState = { started: boolean; s: number }
export function createConvoy(): ConvoyState {
  return { started: false, s: 0 }
}
/** Start so the head is already near the road when the player arrives. */
export function startConvoy(c: ConvoyState): ConvoyState {
  return c.started ? c : { started: true, s: -30 - RUN_FROM }
}
export function stepConvoy(c: ConvoyState, dt: number): ConvoyState {
  if (!c.started) return c
  return { started: true, s: (c.s + CONVOY_SPEED * dt) % CYCLE }
}
/** Front-bumper x of each vehicle (moving +X), or null while off the visible run. */
export function vehicleX(c: ConvoyState, i: number): number | null {
  if (!c.started) return null
  const head = RUN_FROM + c.s
  const x = head - SLOTS[i].offset
  if (x < RUN_FROM || x - SLOTS[i].spec.length > RUN_TO) return null
  return x
}
/** True while any vehicle overlaps the main road. */
export function convoyBlocking(c: ConvoyState): boolean {
  return SLOTS.some((slot, i) => {
    const x = vehicleX(c, i)
    return x !== null && x > -ROAD_HALF - 1 && x - slot.spec.length < ROAD_HALF + 1
  })
}
export function convoyBoxes(c: ConvoyState, out: Box[]): void {
  SLOTS.forEach((slot, i) => {
    const x = vehicleX(c, i)
    if (x === null) return
    const w = slot.spec.width / 2
    out.push({ min: [x - slot.spec.length, 0, Z.convoyLane - w], max: [x, slot.spec.height, Z.convoyLane + w], kind: 'wall' })
  })
}

export function semi(): THREE.Group {
  const g = new THREE.Group()
  const white = new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.35, metalness: 0.2 })
  const dark = new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.4, metalness: 0.3 })
  const glass = new THREE.MeshStandardMaterial({ color: '#0b1220', roughness: 0.08, metalness: 0.6 })
  const trailerMat = new THREE.MeshStandardMaterial({ color: '#d9dde2', roughness: 0.55, metalness: 0.25 })
  const L = SPEC.semi.length
  // Cab (front at local x = 0, extends towards -x), rounded aero nose approximated with a wedge.
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.2, 2.5), white)
  cab.position.set(-1.9, 2.05, 0)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.6, 2.45), white)
  nose.position.set(-0.4, 1.25, 0)
  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 2.3), glass)
  wind.position.set(-0.22, 2.85, 0)
  wind.rotation.z = -0.35
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.5, 2.55), dark)
  skirt.position.set(-1.9, 0.55, 0)
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 2.2), new THREE.MeshBasicMaterial({ color: '#f4fbff', toneMapped: false }))
  lamp.position.set(0.12, 1.55, 0)
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(L - 4.2, 3.0, 2.6), trailerMat)
  trailer.position.set(-4.0 - (L - 4.2) / 2, 2.55, 0)
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L - 4.4, 0.22, 2.62), new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.5 }))
  stripe.position.set(-4.0 - (L - 4.2) / 2, 1.5, 0)
  g.add(cab, nose, wind, skirt, lamp, trailer, stripe)
  for (const x of [-1.2, -3.0, -L + 3.2, -L + 1.8]) {
    for (const z of [-1.15, 1.15]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.4, 14), dark)
      w.rotation.x = Math.PI / 2
      w.position.set(x, 0.52, z)
      g.add(w)
    }
  }
  g.traverse(o => ((o as THREE.Mesh).castShadow = true))
  return g
}

export function pickup(): THREE.Group {
  const g = new THREE.Group()
  const steel = new THREE.MeshStandardMaterial({ color: '#b7bcc2', roughness: 0.28, metalness: 0.85 })
  const glass = new THREE.MeshStandardMaterial({ color: '#0b1220', roughness: 0.06, metalness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.5 })
  const L = SPEC.pickup.length
  // Side profile: a single wedge (front low, peak above the cab, long sloping bed cover).
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.55)
  shape.lineTo(0, 1.15)
  shape.lineTo(-2.2, 1.95)
  shape.lineTo(-L, 1.25)
  shape.lineTo(-L, 0.55)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: SPEC.pickup.width, bevelEnabled: false })
  geo.translate(0, 0, -SPEC.pickup.width / 2)
  const body = new THREE.Mesh(geo, steel)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 2.1), new THREE.MeshBasicMaterial({ color: '#f4fbff', toneMapped: false }))
  bar.position.set(0.02, 1.12, 0)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 2.1), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }))
  tail.position.set(-L - 0.02, 1.2, 0)
  g.add(body, bar, tail)
  // Windows strip along the top edges.
  const side = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.42, SPEC.pickup.width + 0.02), glass)
  side.position.set(-2.4, 1.52, 0)
  g.add(side)
  for (const x of [-1.0, -L + 1.1]) {
    for (const z of [-1.0, 1.0]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.36, 14), dark)
      w.rotation.x = Math.PI / 2
      w.position.set(x, 0.46, z)
      g.add(w)
    }
  }
  g.traverse(o => ((o as THREE.Mesh).castShadow = true))
  return g
}

export class ConvoyView {
  readonly group = new THREE.Group()
  private readonly vehicles: THREE.Group[]

  constructor() {
    this.vehicles = SLOTS.map(slot => {
      const v = slot.spec.kind === 'semi' ? semi() : pickup()
      v.visible = false
      this.group.add(v)
      return v
    })
  }

  update(c: ConvoyState): void {
    this.vehicles.forEach((v, i) => {
      const x = vehicleX(c, i)
      v.visible = x !== null
      if (x !== null) v.position.set(x, 0, Z.convoyLane)
    })
  }
}
