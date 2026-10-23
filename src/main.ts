import './styles/main.css'
import { Audio } from './engine/audio'
import { I18n } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import type { Game } from './game/game'
import { Ui } from './ui/ui'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()
  const i18n = new I18n()
  const input = new Input(canvas)
  const audio = new Audio()
  let game: Game | undefined

  const applySettings = (d: SaveData) => {
    audio.setVolumes(d.musicVolume, d.sfxVolume, d.muted)
    if (game) game.reducedMotion = d.reducedMotion
  }
  const startRun = () => {
    if (!game) return
    audio.unlock()
    audio.startMusic()
    game.start()
    ui.show('hud')
    loop.resetAccumulator()
    canvas.focus()
  }
  const pause = () => {
    if (game?.mode !== 'playing') return
    game.pause()
    ui.show('pause')
  }
  const resume = () => {
    if (game?.mode !== 'paused') return
    game.resume()
    ui.show('hud')
    loop.resetAccumulator()
  }
  const ui = new Ui(i18n, save, audio, input, {
    play: startRun,
    restart: startRun,
    resume,
    quit: () => {
      game?.toTitle()
      ui.show('title')
    },
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (qualityChanged) game?.setQuality(save.data.quality)
    },
  })
  ui.show('boot')
  applySettings(save.data)

  let loaded = 0
  const track = <T>(p: Promise<T>): Promise<T> => p.then(v => (ui.setBootProgress(0.1 + (++loaded / 4) * 0.9), v))
  ui.setBootProgress(0.1)
  const [{ Game }, { Renderer, suggestQuality }] = await Promise.all([
    track(import('./game/game')),
    track(import('./engine/renderer')),
    track(document.fonts.ready),
  ])
  if (firstRun) {
    save.update({ quality: suggestQuality() })
    ui.refreshSettings()
  }
  const renderer = new Renderer(canvas, save.data.quality)
  game = new Game(renderer, input, audio, {
    message: (key, kind, vars) => ui.message(key, kind, vars),
    coach: step => ui.coach(step),
    zone: z => ui.zone(z),
    end: run => window.setTimeout(() => ui.showResults(run), 1600),
  })
  game.reducedMotion = save.data.reducedMotion
  // The car model is the only required runtime asset; the procedural body covers a failed load.
  await track(game.loadModel())
  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
  }
  const g = game
  const loop = new GameLoop({
    step: dt => g.step(dt),
    render: (alpha, frameSeconds) => {
      input.update()
      if (input.consume('pause')) {
        if (g.mode === 'playing') pause()
        else if (g.mode === 'paused' && ui.screen === 'pause') resume()
      }
      if (input.consume('mute')) ui.toggleMute()
      ui.frame()
      loop.paused = g.mode === 'paused'
      g.render(alpha, frameSeconds)
      if (g.mode === 'playing' || g.mode === 'ended') ui.updateHud(g.hud)
    },
  })
  loop.start()
  // Focus loss or a background tab pauses the drive and drops held keys.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.clear()
      pause()
    }
  })
  window.addEventListener('blur', () => {
    input.clear()
    pause()
  })
  window.addEventListener('game:pause', pause)
  window.setTimeout(() => ui.show('title'), 250)
  // Debug/test hook (read-only use): smoke tests inspect run state through it.
  ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

boot().catch(err => {
  console.error(err)
  const el = document.getElementById('ui')
  if (el) el.innerHTML = `<div class="fatal">启动失败：${String((err as Error)?.message ?? err).replace(/[<>&]/g, '')}</div>`
})
