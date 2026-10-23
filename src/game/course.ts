/**
 * The route home as plain data: drivable surfaces, solid boxes, safe nodes, rings and zones.
 * Forward along the route is -Z. The main road is centred on x = 0 with two lanes at ±1.8 m.
 * Everything here is pure so tests can check that the route is connected and solvable.
 *
 * One main road, no side routes: office lot → jam (wait or hop over) → loop 1 → railway
 * crossing → truck convoy crossing → loop 2 → residential street → home. The two full loops are
 * on the road itself: drive in from the left lane, ride through the inverted top, exit right.
 */
export type V3 = [number, number, number]
export type Box = { min: V3; max: V3; kind: BoxKind; /** false = drawn, but the car drives through it. */ solid?: boolean }
export type BoxKind = 'wall' | 'rail' | 'building' | 'fence' | 'pillar' | 'bounds' | 'hedge' | 'deck' | 'closure' | 'ramp' | 'truck'
export type Rect = { x0: number; x1: number; z0: number; z1: number }
export type SafeNode = { id: number; x: number; z: number; yaw: number; y?: number }
export type ZoneId = 'lot' | 'road' | 'jam' | 'railApproach' | 'convoy' | 'residential' | 'stunt' | 'flip' | 'home'

export const ROAD_HALF = 4.6
export const LANES = [-1.8, 1.8] as const
/** Everything from the residential street onward moved down the route by this much. */
const H = -244

export const Z = {
  lotEnd: -25,
  bypassIn0: -120,
  bypassIn1: -140,
  jamTail: -168,
  pit0: -155,
  pit1: -200,
  stopLine: -245,
  bypassEnd: -250,
  sideRoad0: -258,
  sideRoad1: -280,
  railStop: -328,
  gateNear: -332,
  track: -340,
  gateFar: -348,
  fenceNear: -334,
  fenceFar: -346,
  padStart: -298,
  deck0: -324,
  deck1: -356,
  bridgeLand1: -378,
  // Truck convoy crossing.
  convoyStop: -417,
  convoyNear: -424,
  convoyLane: -430,
  convoyFar: -436,
  // Road closure plaza with the ramp.
  plaza0: -470,
  detourGate: -478,
  closure: -528,
  plaza1: -560,
  residential: -450,
  homeZ0: -556 + H,
  homeZ1: -576 + H,
  end: -590 + H,
} as const

/** Full loops on the main road: entered heading -Z at zEntry, exit shifted right by LOOP_SHIFT. */
export type Loop = { zEntry: number; radius: number }
export const LOOPS: readonly Loop[] = [{ zEntry: -665, radius: 8 }]
/**
 * Roadster flip ramp (the launch-event stunt): a half-pipe curl. The car spirals up the right-hand
 * wall onto the ceiling, leaves the lip upside down heading on down the road, rolls upright in
 * the air and flies over the parked trucks.
 */
export const FLIP = { zStart: -712, length: 30, radius: 6.2, x0: -2.2, minSpeed: 19 }
/** Parked Tesla trucks the flip flies over (left lane; the right lane stays open). */
export const FLYOVER: Array<{ kind: 'semi' | 'pickup'; x: number; z: number; length: number; width: number; height: number }> = [
  { kind: 'pickup', x: -2.4, z: -751, length: 5.8, width: 2.1, height: 1.9 },
  { kind: 'semi', x: -2.4, z: -760, length: 7.5, width: 2.5, height: 3.9 },
]
export const LOOP_SHIFT = 4.4
/** Minimum speed a loop gives the car on entry (the boost strip in front of it), m/s. */
export const LOOP_MIN_SPEED = 20
/** Length of the guide zone in front of each loop that eases cars into the left lane (m). */
export const LOOP_MERGE = 28
/**
 * Home sits across the end of the road; reaching the apron in front of it finishes the trip.
 * The shell is set back from the asphalt so the mesh does not share a face with the road.
 */
export const HOME_SETBACK = 1.35
/** Slab around the finish house. The building collider uses the same footprint. */
export const HOME_SHELL = { porch: 1.05, back: 0.35, side: 0.7, gap: 0.04 } as const
export const HOME_HOUSE = { x0: -13, x1: 13, z0: Z.end - 14 - HOME_SETBACK, z1: Z.end - HOME_SETBACK, h: 8 }
export const SPOT: Rect = { x0: -ROAD_HALF - 1, x1: ROAD_HALF + 1, z0: Z.end, z1: Z.homeZ1 + 4 }
/** Concrete apron. The far edge stops short of the porch; the near edge is unchanged. */
export const HOME_DRIVE: Rect = { x0: -ROAD_HALF, x1: ROAD_HALF, z0: HOME_HOUSE.z1 + HOME_SHELL.porch + HOME_SHELL.gap, z1: Z.homeZ1 + 4 }
export const WORLD_Z_END = Z.end - 24

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: BoxKind = 'wall', solid = true): Box => ({
  min: [Math.min(x0, x1), y0, Math.min(z0, z1)],
  max: [Math.max(x0, x1), y1, Math.max(z0, z1)],
  kind,
  ...(solid ? {} : { solid: false }),
})
const wallZ = (x: number, z0: number, z1: number, h = 5, kind: BoxKind = 'wall', t = 0.6, solid = true) => box(x - t / 2, x + t / 2, 0, h, z0, z1, kind, solid)
const wallX = (z: number, x0: number, x1: number, h = 5, kind: BoxKind = 'wall', t = 0.6) => box(x0, x1, 0, h, z - t / 2, z + t / 2, kind)

const R = ROAD_HALF + 0.3

export const WALLS: Box[] = [
  // World bounds.
  wallZ(-70, 40, WORLD_Z_END, 80, 'bounds', 2), wallZ(70, 40, WORLD_Z_END, 80, 'bounds', 2),
  wallX(40, -70, 70, 80, 'bounds', 2), wallX(WORLD_Z_END, -70, 70, 80, 'bounds', 2),
  // Office and lot.
  box(-26, 26, 0, 22, 18, 40, 'building'),
  wallZ(-24, 18, Z.lotEnd, 1.2, 'hedge'), wallZ(24, 18, Z.lotEnd, 1.2, 'hedge'),
  wallX(Z.lotEnd, -24, -R, 1.2, 'hedge'), wallX(Z.lotEnd, R, 24, 1.2, 'hedge'),
  // Road A. Guardrails stay visible; the concrete walls along both sides of the road are gone.
  wallZ(-R, Z.lotEnd, Z.bypassIn0, 1.0, 'rail', 0.6, false), wallZ(R, Z.lotEnd, Z.bypassIn0, 1.0, 'rail', 0.6, false),
  // Side street off the jam. Not a roadside wall.
  wallX(Z.sideRoad0, -62, -R, 4.5), wallX(Z.sideRoad1, -62, -R, 4.5), wallZ(-62, Z.sideRoad0, Z.sideRoad1, 4.5),
  wallX(Z.fenceNear, -70, -R, 2.2, 'fence', 0.3), wallX(Z.fenceNear, R, 70, 2.2, 'fence', 0.3),
  wallX(Z.fenceFar, -70, -R, 2.2, 'fence', 0.3), wallX(Z.fenceFar, R, 70, 2.2, 'fence', 0.3),
  wallX(Z.convoyNear, -70, -R, 1.2, 'hedge'), wallX(Z.convoyNear, R, 70, 1.2, 'hedge'),
  wallX(Z.convoyFar, -70, -R, 1.2, 'hedge'), wallX(Z.convoyFar, R, 70, 1.2, 'hedge'),
  // Under the low exit end of each loop (right lane, behind the entry): solid so nothing drives into it.
  ...LOOPS.map(l => box(0.2, R - 0.1, 0, 2, l.zEntry + 0.4, l.zEntry + Math.sqrt(2 * 1.6 * l.radius), 'ramp')),
  // The flip curl rises over the right lane: solid there so a car that missed the entry slides off it.
  box(0.9, R - 0.1, 0, 1.6, FLIP.zStart - FLIP.length, FLIP.zStart - 1.5, 'ramp'),
  ...FLYOVER.map(t => box(t.x - t.width / 2, t.x + t.width / 2, 0, t.height, t.z - t.length / 2, t.z + t.length / 2, 'truck')),
  // Residential hedges stop at the apron so they do not run into the house.
  wallZ(-R, Z.residential, HOME_DRIVE.z0, 1.1, 'hedge', 0.6, false),
  wallZ(R, Z.residential, HOME_DRIVE.z0, 1.1, 'hedge', 0.6, false),
  box(HOME_HOUSE.x0 - HOME_SHELL.side, HOME_HOUSE.x1 + HOME_SHELL.side, 0, HOME_HOUSE.h + 0.7, HOME_HOUSE.z0 - HOME_SHELL.back, HOME_HOUSE.z1 + HOME_SHELL.porch, 'building'),
]

export const CEILINGS: Box[] = []

export const HOUSES: Array<{ x: number; z: number; w: number; d: number; h: number; hue: number }> = []
for (let i = 0; i < 6; i += 1) {
  const z = Z.residential - 18 - i * 28
  HOUSES.push({ x: -16, z, w: 13, d: 14, h: 6 + (i % 3), hue: (i * 47) % 360 })
  HOUSES.push({ x: 16, z: z - 8, w: 12, d: 13, h: 5.5 + ((i + 1) % 3), hue: (i * 83 + 20) % 360 })
}
for (const h of HOUSES) WALLS.push(box(h.x - h.w / 2, h.x + h.w / 2, 0, h.h, h.z - h.d / 2, h.z + h.d / 2, 'building'))

export const PARKED: Array<{ x: number; z: number; hue: number }> = [
  { x: 3.1, z: Z.residential - 35, hue: 200 }, { x: -3.1, z: Z.residential - 70, hue: 20 }, { x: 3.1, z: Z.residential - 105, hue: 120 }, { x: -3.1, z: Z.residential - 140, hue: 280 },
]
for (const p of PARKED) WALLS.push(box(p.x - 1, p.x + 1, 0, 1.4, p.z - 2.2, p.z + 2.2, 'wall'))

export const SAFE_NODES: SafeNode[] = [
  { id: 0, x: 0, z: 0, yaw: 0 },
  { id: 1, x: 0, z: -105, yaw: 0 },
  { id: 2, x: 1.8, z: -315, yaw: 0 },
  { id: 3, x: 0, z: -392, yaw: 0 },
  { id: 4, x: 0, z: -458, yaw: 0 },
  { id: 5, x: 0, z: -540, yaw: 0 },
  { id: 6, x: 0, z: -640, yaw: 0 },
  { id: 7, x: -2.2, z: -785, yaw: 0 },
]

export const RINGS: Array<{ x: number; y: number; z: number; r: number }> = []

export const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

export function groundAt(_x: number, _z: number, _y: number): number {
  return 0
}

export function inRailCorridor(z: number): boolean {
  return z < Z.fenceNear && z > Z.fenceFar
}

const smooth = (u: number) => u * u * (3 - 2 * u)

/** Index of the loop whose entry captures a grounded car at (x, z), or -1. */
export function loopAt(x: number, z: number): number {
  return LOOPS.findIndex(l => x > -R && x < 0.3 && z >= l.zEntry - 0.5 && z <= l.zEntry + 1.0)
}

/** Loop whose merge zone (right lane, just before the entry) contains z, or -1. */
export function loopMergeAt(z: number): number {
  const i = LOOPS.findIndex(l => z < l.zEntry + l.radius + LOOP_MERGE && z > l.zEntry + 0.5)
  if (i >= 0) return i
  return z < FLIP.zStart + LOOP_MERGE && z > FLIP.zStart + 0.5 ? LOOPS.length : -1
}

/** True where a grounded car (left lane, heading down the road) enters the flip curl. */
export function flipAt(x: number, z: number): boolean {
  return x > -R && x < 0.6 && z >= FLIP.zStart - 0.5 && z <= FLIP.zStart + 1.0
}
/** Point on the flip curl at progress s (0 = road level, 1 = the lip, upside down). */
export function flipPoint(s: number, xStart: number): { x: number; y: number; z: number; phi: number } {
  const u = Math.max(0, Math.min(1, s))
  const phi = Math.PI * smooth(u)
  const k = smooth(Math.min(1, u * 3))
  const xc = xStart + (FLIP.x0 - xStart) * k
  return { x: xc + FLIP.radius * Math.sin(phi), y: FLIP.radius * (1 - Math.cos(phi)), z: FLIP.zStart - FLIP.length * u, phi }
}

/** Point on loop i at angle θ (0 = entry at the bottom, π = inverted at the top, 2π = exit). */
export function loopPoint(i: number, theta: number, x0: number): { x: number; y: number; z: number } {
  const l = LOOPS[i]
  const u = Math.max(0, Math.min(1, theta / (Math.PI * 2)))
  return { x: x0 + LOOP_SHIFT * smooth(u), y: l.radius - l.radius * Math.cos(theta), z: l.zEntry - l.radius * Math.sin(theta) }
}
/** d(x)/dθ of the lateral shift, for the travel velocity on the loop. */
export function loopShiftRate(theta: number): number {
  const u = Math.max(0, Math.min(1, theta / (Math.PI * 2)))
  return (LOOP_SHIFT * 6 * u * (1 - u)) / (Math.PI * 2)
}

export function zoneAt(_x: number, z: number, _y: number): ZoneId {
  if (z > Z.lotEnd) return 'lot'
  if (z > Z.jamTail + 40) return 'road'
  if (z > Z.sideRoad1) return 'jam'
  if (z > Z.fenceFar - 6) return 'railApproach'
  if (z > Z.residential) return 'convoy'
  if (z > LOOPS[0].zEntry + LOOPS[0].radius + LOOP_MERGE + 8) return 'residential'
  if (z > FLIP.zStart + LOOP_MERGE) return 'stunt'
  if (z > FLIP.zStart - FLIP.length - 30) return 'flip'
  return 'home'
}

export function routeProgress(z: number): number {
  return Math.max(0, Math.min(1, z / SPOT.z1))
}
export const HOME_POINT = { x: (SPOT.x0 + SPOT.x1) / 2, z: (SPOT.z0 + SPOT.z1) / 2 }
