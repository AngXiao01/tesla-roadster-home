import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_ACTION' | 'NEXT_RUN'
type Boundary = 'run'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string;
  default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; boundary?: Boundary; read(): number; write(value: number): void }
type Section = keyof typeof CONFIG

const CATEGORY: Record<Section, string> = { input: 'Input', car: 'Driving', jets: 'Jets', gas: 'Gas', traffic: 'Traffic', rail: 'Railway', park: 'Parking', camera: 'Camera' }
const bindings: Binding[] = []

function number<S extends Section>(section: S, key: keyof typeof CONFIG[S] & string,
  label: string, min: number, max: number, step: number, unit: string, boundary?: Boundary): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: CATEGORY[section],
    label, description: boundary === 'run' ? 'Applies when a new drive starts.' : 'Updates this preview immediately.',
    unit, default: defaults[key], min, max, step,
    applyMode: boundary === 'run' ? 'NEXT_RUN' : 'LIVE',
    integrity: section === 'camera' ? 'COSMETIC' : 'GAMEPLAY' }), boundary,
    read: () => values[key], write: value => { values[key] = value } })
}

number('car', 'maxSpeed', 'Electric top speed', 10, 40, 1, 'm/s')
number('car', 'accel', 'Acceleration', 4, 24, 0.5, 'm/s²')
number('car', 'turnRate', 'Steering rate', 0.8, 3.5, 0.1, 'rad/s')
number('car', 'gravity', 'Gravity', -30, -8, 0.5, 'm/s²')
number('jets', 'rear', 'Rear jet thrust', 4, 30, 0.5, 'm/s²')
number('jets', 'lift', 'Lift jet thrust', 17, 45, 0.5, 'm/s²')
number('jets', 'yaw', 'Side jet yaw', 1, 12, 0.5, 'rad/s²')
number('gas', 'regen', 'Gas regeneration', 2, 30, 1, '/s')
number('gas', 'costLift', 'Lift gas cost', 5, 50, 1, '/s')
number('gas', 'costRear', 'Rear gas cost', 5, 50, 1, '/s')
number('rail', 'trainSpeed', 'Train speed', 10, 45, 1, 'm/s', 'run')
number('camera', 'fov', 'Field of view', 45, 90, 1, '°')
number('camera', 'distance', 'Camera distance', 5, 14, 0.5, 'm')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
/** Lift must overcome gravity or the car could never leave the ground. */
const valid = (values: Record<string, number>) => values['jets.lift'] > -values['car.gravity']
let unranked = false
const gameplayModified = () => bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)

export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>
    const nextActive = this.read().active
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') nextActive[id] = value
    if (!valid(candidate) || !valid(nextActive)) throw new Error('Lift thrust must exceed gravity')
    requested = candidate
    for (const [id, value] of entries) {
      const binding = byId.get(id)!
      if (binding.control.applyMode === 'LIVE') binding.write(value)
    }
    unranked ||= gameplayModified()
  },
  activate(boundary: Boundary): void {
    for (const binding of bindings) if (binding.boundary === boundary) binding.write(requested[binding.control.id])
    unranked = boundary === 'run' ? gameplayModified() : unranked || gameplayModified()
  },
}
