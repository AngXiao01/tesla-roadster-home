import * as THREE from 'three'
import { pickup, semi } from './convoy'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  FLIP, flipPoint, FLYOVER, HOME_DRIVE, HOME_HOUSE, HOME_SHELL, HOUSES, LOOP_MERGE, loopPoint, LOOPS, PARKED, RINGS, ROAD_HALF, SPOT, WALLS, WORLD_Z_END, Z, type Box,
} from './course'
import type { Light } from './rules'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const R = ROAD_HALF + 0.3

// ─── procedural textures ─────────────────────────────────────────────────────
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 8
  return t
}
function speckle(g: CanvasRenderingContext2D, s: number, base: string, dots: Array<[string, number]>, seed: number, size = 2): void {
  g.fillStyle = base
  g.fillRect(0, 0, s, s)
  const r = rng(seed)
  for (const [col, n] of dots) {
    g.fillStyle = col
    for (let i = 0; i < n; i += 1) g.fillRect(r() * s, r() * s, size * (0.5 + r()), size * (0.5 + r()))
  }
}
const asphaltTex = (rep: [number, number], base = '#3a3d44') =>
  canvasTex(256, (g, s) => {
    speckle(g, s, base, [['#2c2f35', 2600], ['#4a4e57', 2200], ['#565a63', 500]], 7, 1.6)
    g.fillStyle = 'rgba(20,22,26,0.18)'
    g.fillRect(s * 0.18, 0, s * 0.12, s)
    g.fillRect(s * 0.7, 0, s * 0.12, s)
  }, rep)
const grassTex = (rep: [number, number]) =>
  canvasTex(256, (g, s) => {
    speckle(g, s, '#5d7445', [['#4e663a', 3000], ['#6d8650', 2600], ['#7b9259', 700], ['#8a8c55', 200]], 11, 2.2)
  }, rep)
const concreteTex = (rep: [number, number], base = '#b8b3aa') =>
  canvasTex(256, (g, s) => {
    speckle(g, s, base, [['#a9a49b', 1800], ['#c4bfb6', 1400]], 21, 1.8)
    g.strokeStyle = 'rgba(70,66,60,0.35)'
    g.lineWidth = 3
    g.strokeRect(1.5, 1.5, s - 3, s - 3)
  }, rep)
const hazardTex = (rep: [number, number]) =>
  canvasTex(128, (g, s) => {
    g.fillStyle = '#f5b301'
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#16171a'
    for (let i = -s; i < s * 2; i += 32) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + 16, 0)
      g.lineTo(i + 16 - s, s)
      g.lineTo(i - s, s)
      g.closePath()
      g.fill()
    }
  }, rep)

/** A canvas-texture sign with Chinese text (uses the bundled CJK font, already loaded at boot). */
function sign(text: string, sub: string, bg: string, w = 6, h = 2.4): THREE.Mesh {
  const c = document.createElement('canvas')
  c.width = 768
  c.height = Math.round((768 * h) / w)
  const g = c.getContext('2d')!
  // Monochrome signage: matte black panel, hairline frame, thin accent bar in the original colour.
  g.fillStyle = '#0a0b0d'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = bg
  g.fillRect(0, 0, c.width, Math.max(6, c.height * 0.05))
  g.strokeStyle = 'rgba(255,255,255,0.35)'
  g.lineWidth = 3
  g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `500 ${Math.round(c.height * 0.32)}px "Helvetica Neue", Arial, "ManusCC0 Sans CJK SC", sans-serif`
  g.fillText(text, c.width / 2, c.height * (sub ? 0.4 : 0.52))
  if (sub) {
    g.globalAlpha = 0.85
    g.font = `400 ${Math.round(c.height * 0.15)}px "Helvetica Neue", Arial, "ManusCC0 Sans CJK SC", sans-serif`
    g.fillText(sub, c.width / 2, c.height * 0.76)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
}

function signPost(text: string, sub: string, bg: string, x: number, z: number, yaw = 0, height = 3.2, w = 6): THREE.Group {
  const g = new THREE.Group()
  const s = sign(text, sub, bg, w)
  s.position.y = height
  const h = (s.geometry as THREE.PlaneGeometry).parameters.height
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.08), new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5, metalness: 0.6 }))
  back.position.set(0, height, -0.06)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, height, 8), new THREE.MeshStandardMaterial({ color: '#6b717c', roughness: 0.4, metalness: 0.7 }))
  pole.position.y = height / 2 - 0.6
  g.add(pole, back, s)
  g.position.set(x, 0, z)
  g.rotation.y = yaw
  return g
}

export class Scenery {
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  private readonly lightRed: THREE.Mesh
  private readonly lightGreen: THREE.Mesh
  private readonly redOn = new THREE.MeshBasicMaterial({ color: '#ff3b30', toneMapped: false })
  private readonly greenOn = new THREE.MeshBasicMaterial({ color: '#30d158', toneMapped: false })
  private readonly lampOff = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.6 })
  readonly rings: THREE.Mesh[] = []
  private readonly homeLight: THREE.PointLight
  private readonly homeWindows = new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffb45c', emissiveIntensity: 0.25, roughness: 0.5 })
  private readonly spotMarker: THREE.Mesh
  private readonly rampLights = new THREE.MeshBasicMaterial({ color: '#7fe3ff', toneMapped: false })
  private homeGlow = 0
  private readonly skyGroup = new THREE.Group()

  constructor(shadowMapSize: number, renderer?: THREE.WebGLRenderer) {
    const scene = this.scene
    if (renderer) {
      // Soft studio reflections so paint, glass and metal read as materials, not flat colours.
      const pm = new THREE.PMREMGenerator(renderer)
      scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environmentIntensity = 0.55
      pm.dispose()
    }
    this.buildSky()
    scene.fog = new THREE.Fog('#a98d84', 150, 560)
    scene.add(new THREE.HemisphereLight('#ffd9b8', '#3a4458', 0.95))
    this.sun = new THREE.DirectionalLight('#ffc28a', 2.6)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    const sc = this.sun.shadow.camera
    sc.left = -50
    sc.right = 50
    sc.top = 50
    sc.bottom = -50
    sc.near = 1
    sc.far = 220
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.02
    scene.add(this.sun, this.sun.target)

    this.buildGround()
    this.buildRoads()
    this.buildWalls()
    this.buildOffice()
    this.buildHouses()
    this.buildConvoyCrossing()
    LOOPS.forEach((_, i) => this.buildLoop(i))
    this.buildFlip()
    this.buildTrees()
    this.buildStreetLamps()
    this.buildMountains()

    // Traffic light at the end of the jam.
    const tl = new THREE.Group()
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.4, metalness: 0.6 })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 10), poleMat)
    pole.position.set(R + 0.6, 3, Z.stopLine - 1)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.18, 0.18), poleMat)
    arm.position.set(R + 0.6 - 2.75, 5.8, Z.stopLine - 1)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.5), new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.5 }))
    head.position.set(0.6, 5.2, Z.stopLine - 1)
    this.lightRed = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), this.redOn)
    this.lightRed.position.set(0.6, 5.62, Z.stopLine - 0.74)
    this.lightGreen = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), this.lampOff)
    this.lightGreen.position.set(0.6, 4.8, Z.stopLine - 0.74)
    tl.add(pole, arm, head, this.lightRed, this.lightGreen)
    scene.add(tl)

    // Rings over the trench.
    const ringMat = new THREE.MeshStandardMaterial({ color: '#7ef9ff', emissive: '#38d6ff', emissiveIntensity: 1.4, roughness: 0.3 })
    for (const r of RINGS) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.14, 10, 48), ringMat.clone())
      ring.position.set(r.x, r.y, r.z)
      this.rings.push(ring)
      scene.add(ring)
    }

    // Signs.
    scene.add(signPost('拥堵 前方 200 米', '可跟车等待 · 也可以喷气飞过', '#b3202f', -R - 0.6, -70, 0, 3.4, 6.5))
    scene.add(signPost('铁路道口', '灯闪请停车等候', '#9a6b00', R + 1.6, Z.railStop + 18, 0, 3.2))
    scene.add(signPost('货运路口', '让行卡车车队', '#9a6b00', R + 1.6, Z.convoyStop + 16, 0, 3.2))
    scene.add(signPost('住宅区 限速 30', '小心慢行', '#2c6e35', R + 1.2, Z.residential + 4, 0, 3.2))
    scene.add(signPost('前方到家', '开到门前即可', '#0b0b0c', R + 1.4, Z.homeZ0 + 8, 0, 3.2, 4))
    const office = sign('公司', '下班啦', '#24303c', 9, 3.2)
    office.position.set(0, 9, 17.85)
    scene.add(office)

    // Home: porch light and window glow brighten on arrival.
    this.homeLight = new THREE.PointLight('#ffb15e', 0, 30, 1.6)
    this.homeLight.position.set(0, 3.6, HOME_HOUSE.z1 + 5)
    scene.add(this.homeLight)
    // Stay inside the apron. The old extra depth ran through the front of the house.
    const spotGeo = new THREE.PlaneGeometry(SPOT.x1 - SPOT.x0, Math.abs(SPOT.z1 - SPOT.z0))
    spotGeo.rotateX(-Math.PI / 2)
    this.spotMarker = new THREE.Mesh(spotGeo, new THREE.MeshBasicMaterial({ color: '#ffd35c', transparent: true, opacity: 0.28, depthWrite: false }))
    this.spotMarker.position.set((SPOT.x0 + SPOT.x1) / 2, 0.045, (SPOT.z0 + SPOT.z1) / 2)
    scene.add(this.spotMarker)
    const spotEdge = new THREE.LineSegments(new THREE.EdgesGeometry(spotGeo), new THREE.LineBasicMaterial({ color: '#fff1b0' }))
    spotEdge.position.copy(this.spotMarker.position).setY(0.06)
    scene.add(spotEdge)
  }

  // ─── sky & horizon ─────────────────────────────────────────────────────────
  private buildSky(): void {
    const skyGeo = new THREE.SphereGeometry(950, 48, 24)
    const colors: number[] = []
    const zenith = new THREE.Color('#070d1f')
    const upper = new THREE.Color('#1b2a55')
    const mid = new THREE.Color('#b4644a')
    const horizon = new THREE.Color('#f0a86a')
    const sunDir = new THREE.Vector3(0.35, 0.08, -1).normalize()
    const sunTint = new THREE.Color('#fff0c8')
    const p = skyGeo.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i += 1) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize()
      const y = v.y
      const c = y < 0.04 ? horizon.clone() : y < 0.2 ? horizon.clone().lerp(mid, (y - 0.04) / 0.16) : y < 0.5 ? mid.clone().lerp(upper, (y - 0.2) / 0.3) : upper.clone().lerp(zenith, (y - 0.5) / 0.5)
      c.lerp(sunTint, Math.pow(Math.max(0, v.dot(sunDir)), 6) * 0.75)
      colors.push(c.r, c.g, c.b)
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
    sky.renderOrder = -10
    this.scene.add(this.skyGroup)
    this.skyGroup.add(sky)
    // Low sun disc ahead of the route (towards home).
    const sun = new THREE.Mesh(new THREE.CircleGeometry(26, 40), new THREE.MeshBasicMaterial({ color: '#fff3d6', fog: false, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }))
    sun.position.copy(sunDir).multiplyScalar(900)
    sun.lookAt(0, 0, 0)
    this.skyGroup.add(sun)
    // Soft cloud streaks.
    const cloudTex = canvasTex(256, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      grd.addColorStop(0, 'rgba(255,220,200,0.55)')
      grd.addColorStop(1, 'rgba(255,220,200,0)')
      g.fillStyle = grd
      g.fillRect(0, 0, s, s)
    }, [1, 1])
    const r = rng(77)
    for (let i = 0; i < 18; i += 1) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.5 + r() * 0.4 }))
      const a = r() * Math.PI * 2
      const el = 0.12 + r() * 0.25
      m.position.set(Math.cos(a) * 800, el * 800, Math.sin(a) * 800)
      m.scale.set(260 + r() * 260, 40 + r() * 30, 1)
      m.lookAt(0, m.position.y * 0.8, 0)
      this.skyGroup.add(m)
    }
  }

  private buildMountains(): void {
    const r = rng(5)
    const far = new THREE.MeshBasicMaterial({ color: '#5d6676', fog: false })
    const near = new THREE.MeshBasicMaterial({ color: '#3c4350', fog: false })
    // Finish shell. A cone that covers this box is pushed out so the house is not buried in it.
    const shell = {
      x0: HOME_HOUSE.x0 - HOME_SHELL.side - 4,
      x1: HOME_HOUSE.x1 + HOME_SHELL.side + 4,
      z0: HOME_HOUSE.z0 - HOME_SHELL.back - 4,
      z1: HOME_HOUSE.z1 + HOME_SHELL.porch + 4,
      y1: HOME_HOUSE.h + 1,
    }
    const covers = (x: number, z: number, rad: number, h: number) => {
      const baseY = -6
      const tipY = h - 6
      for (const py of [0.3, 4, shell.y1]) {
        if (py <= baseY || py >= tipY) continue
        const radAt = rad * (1 - (py - baseY) / (tipY - baseY))
        for (const px of [shell.x0, 0, shell.x1]) {
          for (const pz of [shell.z0, (shell.z0 + shell.z1) / 2, shell.z1]) {
            if (Math.hypot(px - x, pz - z) < radAt) return true
          }
        }
      }
      return false
    }
    for (let i = 0; i < 60; i += 1) {
      const a = (i / 60) * Math.PI * 2 + r() * 0.05
      const isNear = i % 2 === 0
      const dist = isNear ? 640 : 760
      const h = (isNear ? 40 : 70) + r() * (isNear ? 50 : 90)
      const rad = 70 + r() * 80
      const yaw = r() * Math.PI
      let x = Math.cos(a) * dist
      let z = -250 + Math.sin(a) * dist
      for (let n = 0; n < 12 && covers(x, z, rad, h); n += 1) {
        const len = Math.hypot(x, z + 250) || 1
        x += (x / len) * 50
        z += ((z + 250) / len) * 50
      }
      if (covers(x, z, rad, h)) continue
      const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 5), isNear ? near : far)
      m.position.set(x, h / 2 - 6, z)
      m.rotation.y = yaw
      this.scene.add(m)
    }
  }

  // ─── ground & roads ────────────────────────────────────────────────────────
  private buildGround(): void {
    const len = 40 - WORLD_Z_END
    const mat = new THREE.MeshStandardMaterial({ map: grassTex([14, Math.round(len / 10)]), roughness: 1 })
    const parts = [[-70, 70, 40, WORLD_Z_END]]
    for (const [x0, x1, z0, z1] of parts) {
      const geo = new THREE.PlaneGeometry(x1 - x0, z0 - z1)
      geo.rotateX(-Math.PI / 2)
      const m = new THREE.Mesh(geo, mat)
      m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2)
      m.receiveShadow = true
      this.scene.add(m)
    }
    // Grass beyond the world bounds, so the horizon never shows a void.
    const outer = new THREE.Mesh(new THREE.CircleGeometry(1000, 48), new THREE.MeshStandardMaterial({ color: '#56693f', roughness: 1 }))
    outer.rotation.x = -Math.PI / 2
    outer.position.set(0, -0.08, -300)
    this.scene.add(outer)
  }

  private plane(x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, y = 0.02): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0))
    geo.rotateX(-Math.PI / 2)
    const m = new THREE.Mesh(geo, mat)
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2)
    m.receiveShadow = true
    this.scene.add(m)
    return m
  }
  /** Plane with its own texture repeat proportional to size (metres per tile). */
  private texPlane(x0: number, x1: number, z0: number, z1: number, make: (rep: [number, number]) => THREE.Texture, tile: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}, y = 0.02): THREE.Mesh {
    const rep: [number, number] = [Math.max(1, Math.abs(x1 - x0) / tile), Math.max(1, Math.abs(z1 - z0) / tile)]
    return this.plane(x0, x1, z0, z1, new THREE.MeshStandardMaterial({ map: make(rep), roughness: 0.92, ...extra }), y)
  }

  private buildRoads(): void {
    const white = new THREE.MeshBasicMaterial({ color: '#ebe7de' })
    const yellow = new THREE.MeshBasicMaterial({ color: '#f0c43c' })
    const asphalt = (rep: [number, number]) => asphaltTex(rep)
    const lotTex = (rep: [number, number]) => asphaltTex(rep, '#474a52')
    this.texPlane(-24, 24, 18, Z.lotEnd, lotTex, 8)
    // Asphalt ends where the driveway begins, so the two planes meet on an edge.
    const roadEnd = Math.min(HOME_DRIVE.z0, HOME_DRIVE.z1)
    this.texPlane(-R, R, Z.lotEnd, roadEnd, asphalt, 9.6)
    const curb = new THREE.MeshStandardMaterial({ map: concreteTex([1, 60]), roughness: 0.9 })
    for (const x of [-R - 0.35, R + 0.35]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, Z.lotEnd - roadEnd), curb)
      c.position.set(x, 0.07, (Z.lotEnd + roadEnd) / 2)
      c.receiveShadow = true
      this.scene.add(c)
    }
    this.texPlane(-62, -R, Z.sideRoad0, Z.sideRoad1, asphalt, 8)
    this.texPlane(HOME_DRIVE.x0, HOME_DRIVE.x1, HOME_DRIVE.z0, HOME_DRIVE.z1, (rep) => concreteTex(rep, '#9d978c'), 3, {}, 0.025)
    for (let i = -3; i <= 3; i += 1) {
      if (i === 0) continue
      this.plane(i * 6 - 0.08, i * 6 + 0.08, 12, 4, white, 0.03)
    }
    const dash = new THREE.PlaneGeometry(0.16, 3)
    dash.rotateX(-Math.PI / 2)
    const n = Math.floor((Z.lotEnd - Z.end) / 9)
    const dashes = new THREE.InstancedMesh(dash, white, n)
    const d = new THREE.Object3D()
    for (let i = 0; i < n; i += 1) {
      d.position.set(0, 0.03, Z.lotEnd - 4 - i * 9)
      d.updateMatrix()
      dashes.setMatrixAt(i, d.matrix)
    }
    this.scene.add(dashes)
    this.plane(-R + 0.3, -R + 0.45, Z.lotEnd, roadEnd, yellow, 0.03)
    this.plane(R - 0.45, R - 0.3, Z.lotEnd, roadEnd, white, 0.03)
    for (const z of [Z.stopLine, Z.railStop, Z.convoyStop]) this.plane(-R, R, z + 0.3, z - 0.3, white, 0.035)
    const bumpMat = new THREE.MeshStandardMaterial({ map: hazardTex([4, 1]), roughness: 0.8 })
    for (const z of [Z.residential - 25, Z.residential - 85, Z.residential - 155]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.06, 0.8), bumpMat)
      b.position.set(0, 0.05, z)
      this.scene.add(b)
    }
  }

  private buildWalls(): void {
    const mats: Record<string, THREE.Material> = {
      wall: new THREE.MeshStandardMaterial({ map: concreteTex([12, 1]), roughness: 0.85 }),
      rail: new THREE.MeshStandardMaterial({ color: '#d4d8de', roughness: 0.25, metalness: 0.9 }),
      fence: new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.4, metalness: 0.6, transparent: true, opacity: 0.45 }),
      pillar: new THREE.MeshStandardMaterial({ map: concreteTex([1, 2], '#a8a299'), roughness: 0.85 }),
      hedge: new THREE.MeshStandardMaterial({ map: grassTex([8, 1]), color: '#7aa36a', roughness: 1 }),
      closure: new THREE.MeshStandardMaterial({ map: hazardTex([12, 2]), roughness: 0.6 }),
      ramp: new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.5, metalness: 0.6 }),
    }
    const parked = new Set(PARKED.map(p => `${p.x - 1},${p.z - 2.2}`))
    for (const b of WALLS) {
      if (b.kind === 'bounds' || b.kind === 'building' || b.kind === 'truck') continue
      if (parked.has(`${b.min[0]},${b.min[2]}`)) continue
      const m = this.addBox(b, mats[b.kind] ?? mats.wall)
      if (b.kind === 'wall' && b.max[1] > 3) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(b.max[0] - b.min[0] + 0.2, 0.25, b.max[2] - b.min[2] + 0.2), mats.rail)
        cap.position.set(m.position.x, b.max[1] + 0.12, m.position.z)
        this.scene.add(cap)
      }
    }
    for (const p of PARKED) {
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.3), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(p.hue / 360, 0.35, 0.55), roughness: 0.25, metalness: 0.6 }))
      body.position.y = 0.6
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.4), new THREE.MeshStandardMaterial({ color: '#0f1520', roughness: 0.05, metalness: 0.8 }))
      cab.position.set(0, 1.18, 0.2)
      body.castShadow = cab.castShadow = true
      g.add(body, cab)
      g.position.set(p.x, 0, p.z)
      this.scene.add(g)
    }
  }

  private addBox(b: Box, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]), mat)
    m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    m.castShadow = b.max[1] - b.min[1] > 1
    m.receiveShadow = true
    this.scene.add(m)
    return m
  }

  private windowsTexture(cols: number, rows: number, lit: number, seed: number, base: string): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = base
    g.fillRect(0, 0, 256, 256)
    const r = rng(seed)
    const cw = 256 / cols
    const rh = 256 / rows
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        g.fillStyle = r() < lit ? (r() < 0.5 ? '#ffd58a' : '#ffe9c4') : '#1d2738'
        g.fillRect(x * cw + cw * 0.12, y * rh + rh * 0.16, cw * 0.76, rh * 0.62)
      }
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  private buildOffice(): void {
    const tex = this.windowsTexture(14, 9, 0.45, 3, '#33465a')
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.7 })
    const m = new THREE.Mesh(new THREE.BoxGeometry(52, 22, 22), mat)
    m.position.set(0, 11, 29)
    m.castShadow = true
    this.scene.add(m)
    const crown = new THREE.Mesh(new THREE.BoxGeometry(53, 1.2, 23), new THREE.MeshStandardMaterial({ color: '#d8dde3', roughness: 0.3, metalness: 0.8 }))
    crown.position.set(0, 22.6, 29)
    this.scene.add(crown)
    const r = rng(9)
    for (let i = 0; i < 18; i += 1) {
      const h = 18 + r() * 55
      const t = this.windowsTexture(6, 12, 0.35, i + 20, '#2e3b50')
      const b = new THREE.Mesh(new THREE.BoxGeometry(12 + r() * 6, h, 12 + r() * 6), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.5 }))
      b.position.set(-110 + i * 13 + r() * 4, h / 2, 70 + r() * 50)
      this.scene.add(b)
    }
  }

  private buildHouses(): void {
    const roofMat = new THREE.MeshStandardMaterial({ color: '#3d3a3f', roughness: 0.7, metalness: 0.2 })
    for (const [i, h] of HOUSES.entries()) {
      const tex = this.windowsTexture(4, 2, 0.65, 50 + i, `hsl(${h.hue}, 16%, 68%)`)
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.85 })
      const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), mat)
      body.position.set(h.x, h.h / 2, h.z)
      body.castShadow = true
      body.receiveShadow = true
      const roof = new THREE.Mesh(new THREE.BoxGeometry(h.w + 1.2, 0.5, h.d + 1.2), roofMat)
      roof.position.set(h.x, h.h + 0.25, h.z)
      roof.castShadow = true
      this.scene.add(body, roof)
    }
    // Finish house, seated on a slab past the asphalt. Parts overlap only where a face
    // would otherwise be buried; nothing sticks into the road, the ground, or another face.
    const hh = HOME_HOUSE
    const hw = hh.x1 - hh.x0
    const hd = hh.z1 - hh.z0
    const hx = (hh.x0 + hh.x1) / 2
    const hz = (hh.z0 + hh.z1) / 2
    const groundY = 0.006
    const plinthH = 0.26
    const facadeZ = hh.z1
    const plinthFront = facadeZ + HOME_SHELL.porch
    const plinthBack = hh.z0 - HOME_SHELL.back
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(hw + HOME_SHELL.side * 2, plinthH, plinthFront - plinthBack),
      new THREE.MeshStandardMaterial({ color: '#c8c3ba', roughness: 0.88 }),
    )
    plinth.position.set(hx, groundY + plinthH / 2, (plinthFront + plinthBack) / 2)
    plinth.castShadow = true
    plinth.receiveShadow = true
    const floorY = groundY + plinthH
    const sink = 0.04
    const homeMat = new THREE.MeshStandardMaterial({ color: '#d9d9d6', roughness: 0.7 })
    const home = new THREE.Mesh(new THREE.BoxGeometry(hw, hh.h, hd), homeMat)
    home.position.set(hx, floorY - sink + hh.h / 2, hz)
    home.castShadow = true
    home.receiveShadow = true
    const roofH = 0.4
    const roofSink = 0.08
    const roofFront = 0.45
    const roofBack = 0.3
    const roofSide = 0.55
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(hw + roofSide * 2, roofH, hd + roofFront + roofBack),
      new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.4, metalness: 0.5 }),
    )
    const wallTop = floorY - sink + hh.h
    roof.position.set(hx, wallTop - roofSink + roofH / 2, hz + (roofFront - roofBack) / 2)
    roof.castShadow = true
    const front = facadeZ + 0.025
    const woodH = 6.4
    const wood = new THREE.Mesh(new THREE.PlaneGeometry(5.4, woodH), new THREE.MeshStandardMaterial({ color: '#8d6240', roughness: 0.7 }))
    wood.position.set(hh.x0 + 3.1, floorY + 0.08 + woodH / 2, front)
    const doorH = 2.45
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.7, doorH), new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.35, metalness: 0.7 }))
    door.position.set(-1.4, floorY + 0.02 + doorH / 2, front + 0.012)
    const glassH = 1.45
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(7.2, glassH), this.homeWindows)
    glass.position.set(5.2, floorY + 5.35, front + 0.012)
    const homeSign = sign('家', 'HOME', '#0b0b0c', 3.4, 1.2)
    homeSign.position.set(hh.x0 + 3.1, floorY + 5.5, front + 0.03)
    this.scene.add(plinth, home, roof, wood, door, glass, homeSign)
  }

  private buildConvoyCrossing(): void {
    this.texPlane(-70, 70, Z.convoyNear, Z.convoyFar, (rep) => asphaltTex(rep, '#383b42'), 9.6, {}, 0.021)
    const white = new THREE.MeshBasicMaterial({ color: '#ebe7de' })
    const box = new THREE.MeshBasicMaterial({ color: '#f0c43c', transparent: true, opacity: 0.45 })
    for (let i = 0; i < 8; i += 1) this.plane(-R + 0.6 + i * 1.2, -R + 1.1 + i * 1.2, Z.convoyNear - 0.4, Z.convoyFar + 0.4, box, 0.032)
    for (let x = -66; x < 66; x += 9) this.plane(x, x + 3, Z.convoyLane + 0.08, Z.convoyLane - 0.08, white, 0.03)
    const shed = new THREE.Mesh(new THREE.BoxGeometry(36, 10, 26), new THREE.MeshStandardMaterial({ color: '#d7dbe0', roughness: 0.4, metalness: 0.5 }))
    shed.position.set(48, 5, Z.convoyFar - 22)
    shed.castShadow = true
    const band = new THREE.Mesh(new THREE.BoxGeometry(36.2, 1.2, 26.2), new THREE.MeshStandardMaterial({ color: '#b3202f', roughness: 0.5 }))
    band.position.set(48, 8.2, Z.convoyFar - 22)
    this.scene.add(shed, band)
    const depot = sign('物流园', 'ELECTRIC FREIGHT', '#1f2a36', 10, 2.6)
    depot.position.set(48, 5.6, Z.convoyFar - 8.95)
    this.scene.add(depot)
  }

  /** A full loop on the road: white deck with red edge stripes, LED edges, trusses, boost strip and signs. */
  private buildLoop(i: number): void {
    const l = LOOPS[i]
    const w = 4.6
    const seg = 180
    const lift = 0.02
    const at = (th: number, dx = 0, out = 0) => {
      const p = loopPoint(i, th, -2.2)
      // Radial scale about the loop centre: the deck sits a hair outside the wheel line.
      const k = (l.radius + out + lift) / l.radius
      return new THREE.Vector3(p.x + dx, l.radius + (p.y - l.radius) * k, l.zEntry + (p.z - l.zEntry) * k)
    }
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    const t0 = 0.12
    const t1 = Math.PI * 2 - 0.12
    for (let k = 0; k <= seg; k += 1) {
      const th = t0 + ((t1 - t0) * k) / seg
      const a = at(th, -w / 2)
      const b = at(th, w / 2)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
      uv.push(0, k / 8, 1, k / 8)
      if (k < seg) {
        const n = k * 2
        idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const deckTex = canvasTex(128, (cg, s2) => {
      cg.fillStyle = '#d9dde2'
      cg.fillRect(0, 0, s2, s2)
      cg.fillStyle = '#cfd3d9'
      cg.fillRect(0, s2 * 0.47, s2, s2 * 0.06)
      cg.fillStyle = '#e31937'
      cg.fillRect(0, 0, s2 * 0.08, s2)
      cg.fillRect(s2 * 0.92, 0, s2 * 0.08, s2)
    }, [1, 1])
    const deck = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.62, metalness: 0.1, side: THREE.DoubleSide }))
    deck.castShadow = true
    deck.receiveShadow = true
    this.scene.add(deck)
    // LED edges and the dark outer rails.
    const curve = (dx: number, out: number) => new THREE.CatmullRomCurve3(Array.from({ length: 73 }, (_, k) => at(t0 + ((t1 - t0) * k) / 72, dx, out)))
    const railMat = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.4, metalness: 0.85 })
    for (const dx of [-w / 2 - 0.1, w / 2 + 0.1]) {
      this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve(dx, -0.05), 200, 0.09, 8), this.rampLights))
      this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve(dx + Math.sign(dx) * 0.25, 0.35), 200, 0.2, 8), railMat))
    }
    // Truss columns under the upper half, on both outer sides.
    const truss = new THREE.MeshStandardMaterial({ color: '#30353d', roughness: 0.4, metalness: 0.8 })
    for (const th of [0.45, 0.8, 1.15, 1.57, 2.0, 2.4, 2.75, 3.14, 3.5, 3.9, 4.3, 4.71, 5.1, 5.5, 5.85]) {
      const top = at(th, 0, 0.4)
      if (top.y < 2.5) continue
      const centre = loopPoint(i, th, -2.2).x
      for (const dx of [w / 2 + 0.7]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.28, top.y, 0.28), truss)
        col.position.set(centre + dx, top.y / 2, top.z)
        col.castShadow = true
        this.scene.add(col)
      }
    }
    // Boost strip in the left lane: glowing chevrons pointing into the loop.
    const chev = new THREE.MeshBasicMaterial({ color: '#7fe3ff', toneMapped: false })
    for (let k = 0; k < 6; k += 1) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.9, 3), chev)
      c.rotation.x = -Math.PI / 2
      c.rotation.z = Math.PI / 2
      c.position.set(-2.2, 0.04, l.zEntry + 3 + k * 3.2)
      this.scene.add(c)
    }
    // Right lane closed in front of the loop: a diagonal line of cones and a red hatched taper.
    const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a13', roughness: 0.6 })
    const coneBand = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 })
    const z0 = l.zEntry + l.radius + LOOP_MERGE
    const z1 = l.zEntry + 5
    for (let k = 0; k <= 10; k += 1) {
      const u = k / 10
      const x = THREE.MathUtils.lerp(R - 0.4, 0.4, Math.min(1, u * 1.15))
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 10), coneMat)
      cone.position.set(x, 0.4, THREE.MathUtils.lerp(z0, z1, u))
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 10), coneBand)
      band.position.set(x, 0.5, cone.position.z)
      cone.castShadow = true
      this.scene.add(cone, band)
    }
    // Overhead gantry sign.
    const gz = l.zEntry + l.radius + LOOP_MERGE + 14
    const post = new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.4, metalness: 0.8 })
    for (const x of [-R - 0.6, R + 0.6]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7, 0.3), post)
      m.position.set(x, 3.5, gz)
      this.scene.add(m)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(R * 2 + 1.6, 0.35, 0.35), post)
    beam.position.set(0, 6.9, gz)
    this.scene.add(beam)
    const gs = sign(`环道 ${i + 1}`, 'LOOP · 左车道进环', '#0b0b0c', 7.5, 2)
    gs.position.set(0, 5.6, gz + 0.25)
    this.scene.add(gs)
    if (i < 0) {
      // Launch-event set around the second, bigger loop.
      const towerMat = new THREE.MeshStandardMaterial({ color: '#2c3038', roughness: 0.4, metalness: 0.8 })
      const lampMat = new THREE.MeshBasicMaterial({ color: '#fff7e6', toneMapped: false })
      for (const [x, z] of [[13, l.zEntry + 12], [13, l.zEntry - 14], [-13, l.zEntry - 2]] as const) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 20, 8), towerMat)
        mast.position.set(x, 10, z)
        const head = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 0.5), towerMat)
        head.position.set(x, 20, z)
        head.lookAt(0, 8, l.zEntry)
        const lamps = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), lampMat)
        lamps.position.copy(head.position)
        lamps.lookAt(0, 8, l.zEntry)
        lamps.translateZ(0.3)
        this.scene.add(mast, head, lamps)
      }
      const stand = new THREE.MeshStandardMaterial({ color: '#4b515b', roughness: 0.6, metalness: 0.4 })
      for (let k = 0; k < 4; k += 1) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6 * (k + 1), 20), stand)
        step.position.set(-R - 3 - k * 1.6, 0.3 * (k + 1), l.zEntry)
        step.castShadow = true
        this.scene.add(step)
      }
    }
  }

  /** Roadster flip curl: a half-pipe whose right wall rolls over into a ceiling, then parked trucks to fly over. */
  private buildFlip(): void {
    const R = FLIP.radius
    const L = FLIP.length
    const shellGeo = new THREE.CylinderGeometry(R + 0.03, R + 0.03, L, 48, 1, true, 0, Math.PI)
    shellGeo.rotateX(Math.PI / 2)
    const shellTex = canvasTex(128, (g, s2) => {
      g.fillStyle = '#d9dde2'
      g.fillRect(0, 0, s2, s2)
      g.fillStyle = '#c3c8cf'
      for (let k = 0; k < 4; k += 1) g.fillRect(0, (k * s2) / 4, s2, 2)
    }, [6, 3])
    const shell = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }))
    // After rotateX the open half-cylinder spans +X: floor → right wall → ceiling, axis down the road.
    shell.position.set(FLIP.x0, R, FLIP.zStart - L / 2)
    shell.castShadow = true
    shell.receiveShadow = true
    this.scene.add(shell)
    // Glowing racing line along the car's path, and a red lip at the exit.
    const line = new THREE.CatmullRomCurve3(Array.from({ length: 41 }, (_, k) => {
      const p = flipPoint(k / 40, FLIP.x0)
      const n = new THREE.Vector3(FLIP.x0 - p.x, R - p.y, 0).normalize().multiplyScalar(0.06)
      return new THREE.Vector3(p.x + n.x, p.y + n.y, p.z)
    }))
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(line, 120, 0.12, 8), this.rampLights))
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R + 0.08, 0.16, 8, 48, Math.PI), new THREE.MeshStandardMaterial({ color: '#e31937', roughness: 0.4 }))
    lip.rotation.z = -Math.PI / 2
    lip.position.set(FLIP.x0, R, FLIP.zStart - L)
    this.scene.add(lip)
    const ribMat = new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.4, metalness: 0.8 })
    for (let z = FLIP.zStart - 2; z > FLIP.zStart - L; z -= 6) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(R + 0.35, 0.18, 6, 32, Math.PI), ribMat)
      rib.rotation.z = -Math.PI / 2
      rib.position.set(FLIP.x0, R, z)
      this.scene.add(rib)
    }
    // Launch-event set: light towers and a grandstand on the open side.
    const towerMat = new THREE.MeshStandardMaterial({ color: '#2c3038', roughness: 0.4, metalness: 0.8 })
    const lampMat = new THREE.MeshBasicMaterial({ color: '#fff7e6', toneMapped: false })
    const aim = new THREE.Vector3(0, 8, FLIP.zStart - L)
    for (const [x, z] of [[-14, FLIP.zStart - 4], [-14, FLIP.zStart - L - 14], [12, FLIP.zStart - L - 6]] as const) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 20, 8), towerMat)
      mast.position.set(x, 10, z)
      const head = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 0.5), towerMat)
      head.position.set(x, 20, z)
      head.lookAt(aim)
      const lamps = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), lampMat)
      lamps.position.copy(head.position)
      lamps.lookAt(aim)
      lamps.translateZ(0.3)
      this.scene.add(mast, head, lamps)
    }
    const stand = new THREE.MeshStandardMaterial({ color: '#4b515b', roughness: 0.6, metalness: 0.4 })
    for (let k = 0; k < 4; k += 1) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6 * (k + 1), 24), stand)
      step.position.set(-ROAD_HALF - 4 - k * 1.6, 0.3 * (k + 1), FLIP.zStart - L / 2)
      step.castShadow = true
      this.scene.add(step)
    }
    const banner = sign('ROADSTER', 'TESLA · FLIP', '#0b0b0c', 9, 2.2)
    banner.position.set(-ROAD_HALF - 10.5, 4.2, FLIP.zStart - L / 2)
    banner.rotation.y = Math.PI / 2
    this.scene.add(banner)
    // Parked Cybertruck and Semi in the left lane: the flip flies over them.
    for (const t of FLYOVER) {
      const g = t.kind === 'semi' ? semi() : pickup()
      g.rotation.y = Math.PI / 2
      g.position.set(t.x, 0, t.z)
      this.scene.add(g)
    }
  }

  private buildTrees(): void {
    const r = rng(42)
    const spots: Array<[number, number]> = []
    for (let i = 0; i < 300; i += 1) {
      const x = (r() < 0.5 ? -1 : 1) * (26 + r() * 42)
      const z = 30 - r() * (30 - WORLD_Z_END)
      if (Math.abs(z - Z.track) < 6) continue
      if (z < Z.convoyNear + 2 && z > Z.convoyFar - 2) continue
      if (x > 26 && z < Z.convoyFar - 6 && z > Z.convoyFar - 40) continue
      spots.push([x, z])
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6), new THREE.MeshStandardMaterial({ color: '#4a3628', roughness: 1 }), spots.length)
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.2, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), spots.length * 2)
    const d = new THREE.Object3D()
    const palette = ['#3f6b38', '#4f7a3f', '#5d8445', '#6d7f3a', '#8a7b3a', '#a0693a']
    const col = new THREE.Color()
    spots.forEach(([x, z], i) => {
      const s = 0.8 + r() * 0.7
      d.position.set(x, 1.1 * s, z)
      d.scale.setScalar(s)
      d.rotation.set(0, 0, 0)
      d.updateMatrix()
      trunk.setMatrixAt(i, d.matrix)
      for (let k = 0; k < 2; k += 1) {
        d.position.set(x + (k ? 0.7 : -0.3) * s, (3.4 + k * 1.3) * s, z + (k ? -0.4 : 0.3) * s)
        d.scale.set(s * (1.1 - k * 0.3), s * (1.0 - k * 0.25), s * (1.1 - k * 0.3))
        d.rotation.set(r(), r() * 3, 0)
        d.updateMatrix()
        crown.setMatrixAt(i * 2 + k, d.matrix)
        crown.setColorAt(i * 2 + k, col.set(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.9 + r() * 0.2))
      }
    })
    crown.castShadow = true
    trunk.castShadow = true
    this.scene.add(trunk, crown)
  }

  private buildStreetLamps(): void {
    const zs: number[] = []
    for (let z = Z.lotEnd - 10; z > Z.end; z -= 30) zs.push(z)
    const metal = new THREE.MeshStandardMaterial({ color: '#4b5059', roughness: 0.3, metalness: 0.8 })
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 8), metal, zs.length)
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.1, 0.25), metal, zs.length)
    const bulb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.06, 0.22), new THREE.MeshBasicMaterial({ color: '#ffe6b0', toneMapped: false }), zs.length)
    const d = new THREE.Object3D()
    zs.forEach((z, i) => {
      const side = i % 2 ? 1 : -1
      const x = side * (R + 0.9)
      d.position.set(x, 3.25, z)
      d.updateMatrix()
      pole.setMatrixAt(i, d.matrix)
      d.position.set(x - side * 0.8, 6.45, z)
      d.updateMatrix()
      arm.setMatrixAt(i, d.matrix)
      d.position.set(x - side * 1.1, 6.38, z)
      d.updateMatrix()
      bulb.setMatrixAt(i, d.matrix)
    })
    this.scene.add(pole, arm, bulb)
  }

  setLight(light: Light): void {
    this.lightRed.material = light === 'red' ? this.redOn : this.lampOff
    this.lightGreen.material = light === 'green' ? this.greenOn : this.lampOff
  }

  /** Shadow camera follows the car; home lights fade in when `arrived`. */
  update(dt: number, focus: THREE.Vector3, time: number, arrived: boolean, nearHome: boolean): void {
    this.skyGroup.position.set(focus.x, 0, focus.z)
    this.sun.position.set(focus.x + 50, focus.y + 45, focus.z - 60)
    this.sun.target.position.copy(focus)
    const target = arrived ? 1 : nearHome ? 0.35 : 0
    this.homeGlow = THREE.MathUtils.damp(this.homeGlow, target, 2.5, dt)
    this.homeLight.intensity = (this.homeGlow * 60) * 0.35
    this.homeWindows.emissiveIntensity = 0.2 + this.homeGlow * 0.45
    const m = this.spotMarker.material as THREE.MeshBasicMaterial
    m.opacity = 0.18 + 0.14 * (0.5 + 0.5 * Math.sin(time * 3)) * (arrived ? 0 : 1)
    for (const ring of this.rings) ring.rotation.y = Math.sin(time * 0.8) * 0.15
    this.rampLights.color.setHSL(0.53, 1, 0.6 + 0.15 * Math.sin(time * 4))
  }

  markRing(i: number, taken: boolean): void {
    const mat = this.rings[i].material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = taken ? 0.1 : 1.4
    mat.opacity = taken ? 0.4 : 1
    mat.transparent = taken
  }
}
