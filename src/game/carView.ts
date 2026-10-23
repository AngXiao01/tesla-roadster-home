import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CAR } from './car'
import type { JetOutput } from './rules'

/** Local Roadster mesh. Vite serves the public symlink of assets/models/jet-roadster.glb. */
export const CAR_MODEL_URL = '/assets/models/jet-roadster.glb'

type Puff = { life: number; max: number; pos: THREE.Vector3; vel: THREE.Vector3; size: number }
const MAX_PUFFS = 600

/**
 * Visual car: generated GLB (Tesla Roadster) with a procedural fallback body,
 * thruster nozzles and cold-gas plumes as pooled instanced puffs, plus a ground shadow disc and a
 * landing-point ring that stays under the car while airborne.
 */
export class CarView {
  readonly root = new THREE.Group()
  readonly body = new THREE.Group()
  readonly shadow: THREE.Mesh
  readonly marker: THREE.Mesh
  readonly puffs: THREE.InstancedMesh
  private readonly list: Puff[] = []
  private readonly dummy = new THREE.Object3D()
  private fallback: THREE.Group
  modelLoaded = false

  constructor() {
    this.root.add(this.body)
    this.fallback = this.buildFallback()
    this.body.add(this.fallback)
    // Ground shadow disc (works on every quality preset) and landing marker ring.
    const sGeo = new THREE.CircleGeometry(1, 24)
    sGeo.rotateX(-Math.PI / 2)
    this.shadow = new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false }))
    this.shadow.scale.set(1.3, 1, 2.5)
    const mGeo = new THREE.RingGeometry(1.5, 1.8, 32)
    mGeo.rotateX(-Math.PI / 2)
    this.marker = new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({ color: '#7ef9ff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }))
    this.marker.visible = false
    const pMat = new THREE.MeshBasicMaterial({ color: '#e4f7ff', transparent: true, opacity: 0.7, depthWrite: false })
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 1), pMat, MAX_PUFFS)
    this.puffs.frustumCulled = false
    this.puffs.count = 0
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  }

  /** Load the generated model; on failure the procedural body stays. */
  /** Boot waits for one attempt only; on failure the procedural body is used and retries run in the background. */
  async load(url = CAR_MODEL_URL): Promise<boolean> {
    const ok = await this.tryLoad(url)
    if (!ok) this.retryLater(url, 0)
    return ok
  }
  private retryLater(url: string, attempt: number): void {
    const delays = [3000, 8000, 20000, 45000]
    if (attempt >= delays.length) return
    window.setTimeout(() => {
      void this.tryLoad(url).then(ok => { if (!ok) this.retryLater(url, attempt + 1) })
    }, delays[attempt])
  }
  private nozzlesAdded = false
  private async tryLoad(url: string): Promise<boolean> {
    if (this.modelLoaded) return true
    try {
      const gltf = await new GLTFLoader().loadAsync(url)
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      // The generated model's long axis is X; turn it so its nose points down -Z.
      const holder = new THREE.Group()
      model.position.sub(center)
      holder.add(model)
      holder.rotation.y = MODEL_YAW
      const s = CAR.length / Math.max(size.x, size.z)
      holder.scale.setScalar(s)
      holder.position.y = (size.y * s) / 2
      model.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.castShadow = true
          const mat = m.material as THREE.MeshStandardMaterial
          if (mat && 'roughness' in mat) {
            mat.roughness = Math.max(0.35, mat.roughness ?? 0.5)
            mat.metalness = Math.min(0.4, mat.metalness ?? 0)
          }
        }
      })
      this.body.remove(this.fallback)
      this.body.add(holder)
      if (!this.nozzlesAdded) this.addNozzles()
      this.nozzlesAdded = true
      this.modelLoaded = true
      return true
    } catch (err) {
      console.warn('Car model unavailable, using the procedural body for now.', err)
      if (!this.nozzlesAdded) this.addNozzles()
      this.nozzlesAdded = true
      return false
    }
  }

  private buildFallback(): THREE.Group {
    const g = new THREE.Group()
    const paint = new THREE.MeshStandardMaterial({ color: '#e9eaec', roughness: 0.3, metalness: 0.35 })
    const glass = new THREE.MeshStandardMaterial({ color: '#141a24', roughness: 0.15, metalness: 0.4 })
    const tyre = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.55, 4.3), paint)
    body.position.y = 0.55
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 1.2), paint)
    nose.position.set(0, 0.42, -2.0)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.8), glass)
    cab.position.set(0, 1.02, 0.2)
    g.add(body, nose, cab)
    for (const [x, z] of [[-0.95, -1.4], [0.95, -1.4], [-0.95, 1.4], [0.95, 1.4]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14), tyre)
      w.rotation.z = Math.PI / 2
      w.position.set(x, 0.36, z)
      g.add(w)
    }
    g.traverse(o => ((o as THREE.Mesh).castShadow = true))
    return g
  }

  private addNozzles(): void {
    const mat = new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.5, metalness: 0.6 })
    const geo = new THREE.CylinderGeometry(0.12, 0.16, 0.2, 10)
    for (const p of NOZZLES.rear) {
      const n = new THREE.Mesh(geo, mat)
      n.rotation.x = Math.PI / 2
      n.position.copy(p)
      this.body.add(n)
    }
  }

  /** Emit plumes for the jets that fired this frame; directions follow the body orientation. */
  emit(out: JetOutput, world: THREE.Matrix4, carVel: THREE.Vector3, dt: number): void {
    const q = new THREE.Quaternion().setFromRotationMatrix(world)
    const spawn = (local: THREE.Vector3, dir: THREE.Vector3, rate: number, speed: number) => {
      const n = Math.random() < rate * dt * 60 ? Math.ceil(rate) : 0
      for (let i = 0; i < n; i += 1) {
        const pos = local.clone().applyMatrix4(world)
        const d = dir.clone().applyQuaternion(q)
        const vel = d.multiplyScalar(speed * (0.7 + Math.random() * 0.5)).add(carVel.clone().multiplyScalar(0.6))
        vel.x += (Math.random() - 0.5) * 1.5
        vel.y += (Math.random() - 0.5) * 1.5
        vel.z += (Math.random() - 0.5) * 1.5
        if (this.list.length >= MAX_PUFFS) this.list.shift()
        this.list.push({ life: 0, max: 0.45 + Math.random() * 0.3, pos, vel, size: 0.8 + Math.random() * 0.7 })
      }
    }
    if (out.rear > 0) for (const p of NOZZLES.rear) spawn(p, new THREE.Vector3(0, 0, 1), 1.5 * out.rear, 16)
    if (out.lift > 0) for (const p of NOZZLES.under) spawn(p, new THREE.Vector3(0, -1, 0), 1.2 * out.lift, 13)
    if (out.side > 0) {
      // Yaw right: the nose jet exhausts to the left and the tail jet to the right.
      spawn(NOZZLES.sideFL, new THREE.Vector3(-1, 0, 0), 1.2 * out.side, 10)
      spawn(NOZZLES.sideRR, new THREE.Vector3(1, 0, 0), 1.2 * out.side, 10)
    } else if (out.side < 0) {
      spawn(NOZZLES.sideFR, new THREE.Vector3(1, 0, 0), 1.2 * -out.side, 10)
      spawn(NOZZLES.sideRL, new THREE.Vector3(-1, 0, 0), 1.2 * -out.side, 10)
    }
    const st = out.strafe ?? 0
    if (st > 0) {
      // Push right: both left-side nozzles exhaust to the left.
      spawn(NOZZLES.sideFL, new THREE.Vector3(-1, 0, 0), 1.4 * st, 12)
      spawn(NOZZLES.sideRL, new THREE.Vector3(-1, 0, 0), 1.4 * st, 12)
    } else if (st < 0) {
      spawn(NOZZLES.sideFR, new THREE.Vector3(1, 0, 0), 1.4 * -st, 12)
      spawn(NOZZLES.sideRR, new THREE.Vector3(1, 0, 0), 1.4 * -st, 12)
    }
  }

  update(dt: number): void {
    let n = 0
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const p = this.list[i]
      p.life += dt
      if (p.life >= p.max) {
        this.list.splice(i, 1)
        continue
      }
      p.vel.multiplyScalar(Math.exp(-3.5 * dt))
      p.pos.addScaledVector(p.vel, dt)
      const k = p.life / p.max
      this.dummy.position.copy(p.pos)
      this.dummy.scale.setScalar(p.size * (0.6 + k * 1.8) * (1 - k * 0.6))
      this.dummy.updateMatrix()
      this.puffs.setMatrixAt(n, this.dummy.matrix)
      n += 1
    }
    this.puffs.count = n
    this.puffs.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    this.list.length = 0
    this.puffs.count = 0
  }
}

/** Rotation applied to the generated model so that its nose faces -Z (set after inspection). */
export let MODEL_YAW = Math.PI / 2
export function setModelYaw(v: number): void {
  MODEL_YAW = v
}

export const NOZZLES = {
  rear: [new THREE.Vector3(-0.5, 0.5, 2.25), new THREE.Vector3(0.5, 0.5, 2.25)],
  under: [new THREE.Vector3(-0.7, 0.15, -1.4), new THREE.Vector3(0.7, 0.15, -1.4), new THREE.Vector3(-0.7, 0.15, 1.4), new THREE.Vector3(0.7, 0.15, 1.4)],
  sideFL: new THREE.Vector3(-1.05, 0.5, -1.7),
  sideFR: new THREE.Vector3(1.05, 0.5, -1.7),
  sideRL: new THREE.Vector3(-1.05, 0.5, 1.7),
  sideRR: new THREE.Vector3(1.05, 0.5, 1.7),
}
