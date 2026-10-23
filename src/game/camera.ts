import * as THREE from 'three'
import { CONFIG } from './config'
import type { Box } from './course'

/**
 * Chase camera. It follows only the car's yaw (never its roll or pitch) so the horizon stays
 * level during jet manoeuvres, pulls back while airborne and adds a little speed-based FOV.
 */
export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 2000)
  private yaw = 0
  private dist: number = CONFIG.camera.distance
  private readonly focus = new THREE.Vector3()
  private shake = 0
  private occluders: THREE.Box3[] = []
  private readonly ray = new THREE.Ray()
  private readonly hit = new THREE.Vector3()
  /** Broadcast shot (e.g. beside a loop): blended in while active, glides back to the chase view after. */
  private stageBlend = 0
  private readonly stageEye = new THREE.Vector3()
  private readonly stageLook = new THREE.Vector3()
  /** Solid boxes the camera must not sit behind (walls, closure, buildings). */
  setOccluders(boxes: readonly Box[]): void {
    this.occluders = boxes.filter(b => b.kind !== 'bounds' && b.kind !== 'fence' && b.kind !== 'ramp' && b.max[1] - b.min[1] > 1.5).map(b => new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)))
  }

  reset(target: THREE.Vector3, yaw: number): void {
    this.yaw = yaw
    this.dist = CONFIG.camera.distance
    this.focus.copy(target)
    this.update(target, yaw, 0, true, 1, true)
  }

  addShake(v: number): void {
    this.shake = Math.min(1, this.shake + v)
  }

  update(target: THREE.Vector3, carYaw: number, speed: number, grounded: boolean, dt: number, snap = false, reducedMotion = false, stage: { eye: THREE.Vector3; look: THREE.Vector3 } | null = null): void {
    const c = CONFIG.camera
    let d = carYaw - this.yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    this.yaw += snap ? d : d * (1 - Math.exp(-(grounded ? 4.5 : 2.2) * dt))
    const wantDist = (grounded ? c.distance : c.airDistance) + Math.min(3, speed * 0.06)
    this.dist = snap ? wantDist : THREE.MathUtils.damp(this.dist, wantDist, 2, dt)
    const aim = target.clone().add(new THREE.Vector3(0, 1.2, 0))
    if (snap) this.focus.copy(aim)
    else {
      const k = 1 - Math.exp(-c.follow * 1.6 * dt)
      const kv = 1 - Math.exp(-c.follow * 0.7 * dt)
      this.focus.x += (aim.x - this.focus.x) * k
      this.focus.z += (aim.z - this.focus.z) * k
      this.focus.y += (aim.y - this.focus.y) * kv
    }
    const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    this.camera.position.copy(this.focus).addScaledVector(back, this.dist)
    this.camera.position.y = this.focus.y + c.height + (grounded ? 0 : 1)
    // Pull in front of any wall between the car and the camera.
    const toCam = this.camera.position.clone().sub(this.focus)
    const full = toCam.length()
    this.ray.set(this.focus, toCam.normalize())
    let near = full
    for (const b of this.occluders) {
      if (b.containsPoint(this.focus)) continue
      const h = this.ray.intersectBox(b, this.hit)
      if (h) near = Math.min(near, h.distanceTo(this.focus))
    }
    if (near < full) this.camera.position.copy(this.focus).addScaledVector(toCam, Math.max(1.5, near - 0.5))
    const look = this.focus.clone().addScaledVector(back, -6)
    if (stage) {
      this.stageEye.copy(stage.eye)
      this.stageLook.copy(stage.look)
    } else {
      this.stageLook.lerp(aim, 1 - Math.exp(-6 * dt))
    }
    this.stageBlend = snap ? (stage ? 1 : 0) : THREE.MathUtils.damp(this.stageBlend, stage ? 1 : 0, stage ? 3.2 : 2.4, dt)
    if (this.stageBlend > 0.002) {
      const b = this.stageBlend * this.stageBlend * (3 - 2 * this.stageBlend)
      this.camera.position.lerp(this.stageEye, b)
      look.lerp(this.stageLook, b)
    }
    this.camera.lookAt(look)
    const fov = c.fov + Math.min(14, Math.max(0, speed - 12) * 0.5)
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 3, Math.max(dt, 0.016))
      this.camera.updateProjectionMatrix()
    }
    if (this.shake > 0 && !reducedMotion) {
      const s = this.shake * this.shake * 0.3
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s))
    }
    this.shake = Math.max(0, this.shake - dt * 2.5)
  }
}
