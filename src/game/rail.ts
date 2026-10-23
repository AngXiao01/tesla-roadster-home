import * as THREE from 'three'
import { CONFIG } from './config'
import { ROAD_HALF, Z, type Box } from './course'
import type { CrossingState } from './rules'

const CAR_LEN = 14
const CAR_GAP = 1
const RUN_FROM = -130
const RUN_TO = 130

export function trainLength(): number {
  return CONFIG.rail.trainCars * (CAR_LEN + CAR_GAP)
}
export function trainSeconds(): number {
  return (RUN_TO - RUN_FROM + trainLength()) / CONFIG.rail.trainSpeed
}
/** x of the train's head at progress k (moves towards +X). */
export function trainHead(k: number): number {
  return RUN_FROM + k * (RUN_TO - RUN_FROM + trainLength())
}

/** Solid boxes: lowered gates and the train while it is on the crossing run. */
export function railBoxes(s: CrossingState, out: Box[]): void {
  if (s.gate > 0.6) {
    for (const z of [Z.gateNear, Z.gateFar]) out.push({ min: [-ROAD_HALF, 0, z - 0.25], max: [ROAD_HALF, 1.25, z + 0.25], kind: 'rail' })
  }
  if (s.phase === 'train') {
    const head = trainHead(s.train)
    out.push({ min: [head - trainLength(), 0, Z.track - 1.8], max: [head, 4.4, Z.track + 1.8], kind: 'wall' })
  }
}

export class RailView {
  readonly group = new THREE.Group()
  private readonly train = new THREE.Group()
  private readonly arms: THREE.Object3D[] = []
  private readonly lamps: THREE.Mesh[] = []
  private readonly lampOn = new THREE.MeshBasicMaterial({ color: '#ff3b30', toneMapped: false })
  private readonly lampOff = new THREE.MeshStandardMaterial({ color: '#3a1414', roughness: 0.6 })

  constructor() {
    // Ballast, sleepers and rails along X.
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(400, 0.12, 5), new THREE.MeshStandardMaterial({ color: '#5d5752', roughness: 1 }))
    ballast.position.set(0, 0.05, Z.track)
    ballast.receiveShadow = true
    this.group.add(ballast)
    const sleeperGeo = new THREE.BoxGeometry(0.35, 0.1, 3.4)
    const sleepers = new THREE.InstancedMesh(sleeperGeo, new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 }), 400)
    const d = new THREE.Object3D()
    for (let i = 0; i < 400; i += 1) {
      d.position.set(-200 + i, 0.14, Z.track)
      d.updateMatrix()
      sleepers.setMatrixAt(i, d.matrix)
    }
    this.group.add(sleepers)
    for (const off of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(400, 0.12, 0.1), new THREE.MeshStandardMaterial({ color: '#b9bcc2', roughness: 0.35, metalness: 0.7 }))
      rail.position.set(0, 0.24, Z.track + off)
      this.group.add(rail)
    }
    // Crossing panels over the road.
    const panel = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2, 0.08, 5), new THREE.MeshStandardMaterial({ color: '#3b3d42', roughness: 0.9 }))
    panel.position.set(0, 0.06, Z.track)
    this.group.add(panel)
    // Gates and lamp posts on both sides of the track.
    const armMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 })
    const stripeMat = new THREE.MeshStandardMaterial({ color: '#d62828', roughness: 0.6 })
    const postMat = new THREE.MeshStandardMaterial({ color: '#2b2d33', roughness: 0.7 })
    for (const [z, side] of [[Z.gateNear, 1], [Z.gateFar, -1]] as const) {
      const postX = side * (ROAD_HALF + 0.8)
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), postMat)
      post.position.set(postX, 0.7, z)
      post.castShadow = true
      this.group.add(post)
      const pivot = new THREE.Object3D()
      pivot.position.set(postX, 1.15, z)
      const len = ROAD_HALF * 2 + 0.4
      const arm = new THREE.Group()
      for (let i = 0; i < 6; i += 1) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len / 6, 0.16, 0.16), i % 2 ? stripeMat : armMat)
        seg.position.x = -side * (len / 12 + (i * len) / 6)
        seg.castShadow = true
        arm.add(seg)
      }
      pivot.add(arm)
      pivot.userData.side = side
      this.arms.push(pivot)
      this.group.add(pivot)
      // Lamp mast with a cross-buck and two alternating lamps.
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 8), postMat)
      mast.position.set(-postX, 2, z)
      this.group.add(mast)
      const buck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.06), armMat)
      buck.position.set(-postX, 3.7, z)
      buck.rotation.z = 0.6
      const buck2 = buck.clone()
      buck2.rotation.z = -0.6
      this.group.add(buck, buck2)
      for (const lx of [-0.45, 0.45]) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), this.lampOff)
        lamp.position.set(-postX + lx, 2.8, z + (side > 0 ? 0.08 : -0.08))
        if (side < 0) lamp.rotation.y = Math.PI
        this.lamps.push(lamp)
        this.group.add(lamp)
      }
    }
    // Train: a locomotive and coaches built once and moved as a group.
    const coachMat = new THREE.MeshStandardMaterial({ color: '#3f7cac', roughness: 0.5, metalness: 0.2 })
    const locoMat = new THREE.MeshStandardMaterial({ color: '#e0a526', roughness: 0.5, metalness: 0.2 })
    const winMat = new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffcc66', emissiveIntensity: 0.6, roughness: 0.4 })
    const roofMat = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.6 })
    for (let i = 0; i < CONFIG.rail.trainCars; i += 1) {
      const car = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN, 3.4, 3.2), i === 0 ? locoMat : coachMat)
      body.position.y = 2.3
      body.castShadow = true
      const roof = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN - 0.4, 0.3, 2.9), roofMat)
      roof.position.y = 4.15
      car.add(body, roof)
      for (const side of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN - 2, 0.9, 0.05), winMat)
        win.position.set(0, 2.9, side * 1.62)
        car.add(win)
      }
      car.position.x = -i * (CAR_LEN + CAR_GAP) - CAR_LEN / 2
      this.train.add(car)
    }
    const headlight = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: '#fff6d0', toneMapped: false }))
    headlight.position.set(0.02, 2.6, 0)
    headlight.rotation.y = Math.PI / 2
    this.train.add(headlight)
    this.train.position.set(RUN_FROM, 0, Z.track)
    this.train.visible = false
    this.group.add(this.train)
  }

  update(s: CrossingState, time: number): void {
    const angle = s.gate * (Math.PI / 2)
    for (const pivot of this.arms) pivot.rotation.z = (pivot.userData.side as number) * -(Math.PI / 2 - angle) * 1
    const flashing = s.phase !== 'open'
    const phase = Math.floor(time * 2.2) % 2
    this.lamps.forEach((lamp, i) => {
      lamp.material = flashing && i % 2 === phase ? this.lampOn : this.lampOff
    })
    this.train.visible = s.phase === 'train'
    if (this.train.visible) this.train.position.x = trainHead(s.train)
  }
}
