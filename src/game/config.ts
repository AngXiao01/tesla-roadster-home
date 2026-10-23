/**
 * All gameplay tuning in one place. Units are metres, seconds and gas units (0..gas.max).
 * Change numbers here before touching game code; tests read the same values.
 */
export const DEFAULT_CONFIG = {
  car: {
    /** Electric drive top speed on the ground (m/s). 24 m/s ≈ 86 km/h. */
    maxSpeed: 24,
    reverseSpeed: 7,
    accel: 12,
    brake: 24,
    /** Rolling drag when no pedal is pressed (1/s): low, so the car coasts. */
    drag: 0.18,
    /** Lateral grip: how quickly sideways slip is removed on the ground (1/s). Lower = more slide. */
    grip: 4.5,
    /** Peak ground yaw rate (rad/s), reached around 8 m/s and reduced at high speed. */
    turnRate: 1.8,
    /** How fast the ground yaw rate follows the steering (1/s): angular inertia. */
    yawResponse: 7,
    gravity: -16,
    /** Hard cap for any speed including jets (m/s). */
    jetMaxSpeed: 40,
    /** Landing vertical speed above which the landing counts as a crash (m/s). */
    crashImpact: 17,
  },
  jets: {
    /** Rear thruster acceleration along the body's forward axis (m/s²). */
    rear: 18,
    /** Underbody thrusters along the body's up axis (m/s²); must exceed -gravity to climb. */
    lift: 27,
    /** Side thruster yaw acceleration (rad/s²) in the air. */
    yaw: 5.5,
    /** Air yaw rate with A/D (rad/s), always available in the air (no gas). */
    yawRate: 2.6,
    /** Q/E lateral thrusters (m/s²), on the ground and in the air. */
    strafe: 17,
    /** W/S attitude thrust along the heading while airborne (m/s², no gas). */
    airThrottle: 11,
    /** How fast horizontal velocity turns towards the heading in the air (rad/s). */
    airAlign: 3.6,
    /** Angular damping in the air (1/s) from the stabilisation trim. */
    angularDamping: 1.6,
    /** Trim that rights pitch/roll in the air (1/s). Not a control input. */
    trim: 2.2,
  },
  gas: {
    max: 100,
    /** Regeneration per second while grounded, not jetting and driving steadily or stopped. */
    regen: 30,
    /** Delay after the last jet use before regeneration resumes (s). */
    regenDelay: 0.3,
    costRear: 10,
    costLift: 13,
    costSide: 5,
    /** Bonus for a clean landing after enough air time. */
    landingBonus: 25,
    landingMinAir: 0.9,
    ringBonus: 20,
    /** Gas restored (at least) after a reset to a safe node. */
    resetFloor: 60,
  },
  traffic: {
    cruise: 9,
    accel: 4,
    decel: 7,
    /** Bumper-to-bumper standstill gap (m) and time headway (s). */
    gap: 2.2,
    headway: 1.1,
    green: 7,
    red: 9,
  },
  rail: {
    warning: 4,
    closed: 2.5,
    clearing: 2.5,
    opening: 1.5,
    trainSpeed: 28,
    trainCars: 7,
    /** Seconds the crossing stays open before the next train cycle. */
    openGap: 26,
  },
  park: {
    maxSpeed: 1.2,
    holdSeconds: 1.2,
  },
  input: {
    /** Keyboard steering ramps in over ~0.2 s and recentres a little faster (units/s). */
    steerIn: 5.5,
    steerOut: 9,
    throttleIn: 6,
  },
  camera: {
    distance: 8.5,
    height: 3.3,
    airDistance: 11,
    follow: 6,
    fov: 64,
  },
} as const

// Gameplay always reads active values here. Source defaults remain immutable for
// Tweak Reset and Save with Manus; Apply never writes source or local storage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
export type Config = typeof CONFIG
