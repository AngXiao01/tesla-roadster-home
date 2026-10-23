import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Quality, SaveData, SaveStore } from '../engine/save'
import type { Hud, MessageKey } from '../game/game'
import { FLIP, routeProgress, Z, type ZoneId, LOOPS } from '../game/course'
import { formatClock, type RunState } from '../game/rules'

export type Screen = 'boot' | 'title' | 'hud' | 'pause' | 'settings' | 'results'
export type UiActions = {
  play(): void
  resume(): void
  restart(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
}

const ICON = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z" fill="currentColor"/><path class="wave" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path class="cross" d="m16 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3Z" fill="currentColor"/></svg>',
  car: '<svg viewBox="0 0 64 28" aria-hidden="true"><path d="M6 20c0-4 3-6 8-7l9-6c3-2 6-3 10-3h7c5 0 9 2 12 6l4 4c3 1 4 3 4 6v3H6Z" fill="currentColor"/><circle cx="17" cy="22" r="5" fill="#1b1838"/><circle cx="48" cy="22" r="5" fill="#1b1838"/></svg>',
}

/** DOM game UI over the canvas. All visible text comes from zh-CN i18n keys. */
export class Ui {
  screen: Screen = 'boot'
  private readonly root: HTMLElement
  private readonly stack: Screen[] = []
  private cache = new Map<string, string>()
  private toastTimer = 0

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: UiActions,
  ) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('input', e => this.onInput(e))
    window.addEventListener('keydown', e => this.onKey(e))
    this.translate()
    this.refreshSettings()
  }

  show(screen: Screen): void {
    this.stack.length = 0
    this.setScreen(screen)
  }
  push(screen: Screen): void {
    this.stack.push(this.screen)
    this.setScreen(screen)
  }
  back(): void {
    const prev = this.stack.pop()
    if (prev) this.setScreen(prev)
    else if (this.screen === 'pause') this.actions.resume()
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const active = el.dataset.screen === screen || (el.dataset.screen === 'hud' && (screen === 'pause' || screen === 'results' || (screen === 'settings' && this.stack.includes('pause'))))
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-hidden', String(!active))
    }
    this.root.dataset.activeScreen = screen
    requestAnimationFrame(() => {
      const first = this.navItems()[0]
      if (first && this.input.method !== 'touch') first.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    })
  }

  setBootProgress(progress: number): void {
    this.q<HTMLElement>('.boot-bar i').style.transform = `scaleX(${Math.max(0.04, Math.min(1, progress))})`
  }

  // ─── HUD ────────────────────────────────────────────────────────────────
  updateHud(h: Hud): void {
    this.set('kmh', String(h.kmh))
    this.set('clock', formatClock(h.elapsed))
    this.set('home', `${h.homeMeters} M`)
    this.q<HTMLElement>('.tl-fill').style.transform = `scaleX(${Math.max(0.005, h.progress)})`
    this.q<HTMLElement>('.tl-car').style.left = `${h.progress * 100}%`
    for (const n of this.qa('.tl-node')) n.classList.toggle('is-passed', parseFloat(n.style.left) / 100 <= h.progress + 0.002)
    const altM = h.grounded ? 0 : h.altitude
    this.set('altv', altM.toFixed(1))
    this.gauge('.g-speed', h.kmh / 150)
    this.gauge('.g-alt', altM / 25)
    const pct = h.gas / h.gasMax
    const gas = this.q<HTMLElement>('.gas-fill')
    gas.style.transform = `scaleX(${pct})`
    this.q('.hud-gas').classList.toggle('is-low', pct < 0.2)
    this.set('gas', h.freeGas ? this.i18n.t('hud.freeGas') : String(Math.round(h.gas)))
    this.q('.hud-gas').classList.toggle('is-free', h.freeGas)
    this.q('.jet-rear').classList.toggle('is-on', h.jets.rear > 0)
    this.q('.jet-lift').classList.toggle('is-on', h.jets.lift > 0)
    this.q('.jet-left').classList.toggle('is-on', h.jets.side < 0 || (h.jets.strafe ?? 0) < 0)
    this.q('.jet-right').classList.toggle('is-on', h.jets.side > 0 || (h.jets.strafe ?? 0) > 0)
    // Situation chips: traffic light while in the jam, crossing status while near the railway.
    const light = this.q('.chip-light')
    const showLight = h.zone === 'jam' || h.zone === 'road'
    light.classList.toggle('is-hidden', !showLight)
    if (showLight) {
      light.dataset.state = h.light
      this.set('light', this.i18n.t(`hud.light.${h.light}`))
    }
    const rail = this.q('.chip-rail')
    const showRail = h.crossingArmed && (h.zone === 'railApproach' || h.zone === 'jam')
    rail.classList.toggle('is-hidden', !showRail)
    if (showRail) {
      rail.dataset.state = h.crossing
      this.set('rail', this.i18n.t(`hud.rail.${h.crossing}`))
    }
    const convoy = this.q('.chip-convoy')
    const showConvoy = h.zone === 'convoy'
    convoy.classList.toggle('is-hidden', !showConvoy)
    if (showConvoy) {
      convoy.dataset.state = h.convoyBlocking ? 'closed' : 'open'
      this.set('convoy', this.i18n.t(h.convoyBlocking ? 'hud.convoy.block' : 'hud.convoy.clear'))
    }
    this.q('.hud-help').classList.toggle('is-faded', h.zone !== 'lot')
    const park = this.q('.hud-park')
    park.classList.toggle('is-hidden', !(h.park > 0))
    this.q<HTMLElement>('.hud-park i').style.transform = `scaleX(${Math.min(1, h.park)})`
  }

  coach(step: number): void {
    const el = this.q('.coach')
    el.classList.toggle('is-hidden', step < 0)
    if (step < 0) return
    const k = (...keys: string[]) => keys.map(x => `<kbd${x.length > 1 ? ' class="wide"' : ''}>${x}</kbd>`).join('')
    const t = (key: string) => `<span>${this.i18n.t(key)}</span>`
    const rows = [
      `${k('W')}${t('coach.drive')}`,
      `${k('Space')}${t('coach.lift')}`,
      `${k('A', 'D')}${t('coach.yaw')}<i class="coach-sep"></i>${k('Q', 'E')}${t('coach.strafe')}`,
      `${k('Shift')}${t('coach.boost')}`,
      `${t('coach.free')}`,
    ]
    this.q('.coach-no').textContent = `0${step + 1}`
    const body = this.q('.coach-body')
    body.innerHTML = rows[step] ?? ''
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }

  zone(z: ZoneId): void {
    const stage = ({ lot: 1, road: 1, jam: 2, railApproach: 3, convoy: 4, residential: 5, stunt: 6, flip: 6, home: 7 } as Record<ZoneId, number>)[z]
    this.set('stageNo', `0${stage} / 07`)
    this.set('zone', this.i18n.t(`zone.${z}`))
    this.set('zoneHint', this.i18n.t(`zone.${z}.hint`))
    const el = this.q('.hud-objective')
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }

  message(key: MessageKey, kind: 'good' | 'bad' | 'info', vars?: Record<string, string | number>): void {
    const el = this.q('.toast')
    el.textContent = this.i18n.t(key, vars)
    el.dataset.kind = kind
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400)
  }

  showResults(run: RunState): void {
    const choice = (c: RunState['jam']) => this.i18n.t(c === 'jet' ? 'results.jet' : c === 'waited' ? 'results.waited' : c === 'drove' ? 'results.drove' : 'results.unknown')
    this.q('.r-time').textContent = formatClock(run.elapsed)
    this.q('.r-jam').textContent = choice(run.jam)
    this.q('.r-rail').textContent = choice(run.rail)
    this.q('.r-convoy').textContent = choice(run.convoy)
    this.q('.r-stunt').textContent = `Plaid 环道 ${run.loops ? '✓' : '—'} · Roadster Flip ${run.flips ? '✓' : '—'}`
    this.q('.r-gas').textContent = String(Math.round(run.gasUsed))
    this.q('.r-landings').textContent = String(run.cleanLandings)
    this.q('.r-resets').textContent = String(run.resets)
    this.show('results')
  }

  refreshSettings(): void {
    const d = this.save.data
    this.q<HTMLInputElement>('[name="musicVolume"]').value = String(d.musicVolume)
    this.q<HTMLInputElement>('[name="sfxVolume"]').value = String(d.sfxVolume)
    for (const t of this.qa<HTMLButtonElement>('.toggle')) {
      const on = d[t.dataset.setting as 'muted' | 'reducedMotion'] === true
      t.setAttribute('aria-pressed', String(on))
      t.querySelector('span')!.setAttribute('data-i18n', on ? 'settings.on' : 'settings.off')
    }
    for (const b of this.qa<HTMLButtonElement>('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.value === d.quality))
    for (const r of this.qa<HTMLInputElement>('input[type="range"]')) r.style.setProperty('--fill', `${((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100}%`)
    this.q('.hud-mute').classList.toggle('is-muted', d.muted)
    this.translate()
  }

  private onClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], .toggle, .seg button')
    if (!target) return
    this.audio.unlock()
    if (target.matches('.toggle')) {
      const key = target.dataset.setting as 'muted' | 'reducedMotion'
      this.actions.settings({ [key]: !this.save.data[key] })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    if (target.matches('.seg button')) {
      this.actions.settings({ quality: target.dataset.value as Quality })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    switch (target.dataset.action) {
      case 'play': this.actions.play(); break
      case 'resume': this.actions.resume(); break
      case 'restart': this.actions.restart(); break
      case 'quit': this.actions.quit(); break
      case 'settings': this.push('settings'); break
      case 'back': this.back(); break
      case 'pause': window.dispatchEvent(new CustomEvent('game:pause')); break
      case 'mute': this.toggleMute(); break
    }
    if (target.dataset.action !== 'mute') this.audio.play('ui')
    // Keep keyboard driving working after clicking a HUD button.
    if (this.screen === 'hud') target.blur()
  }

  toggleMute(): void {
    this.actions.settings({ muted: !this.save.data.muted })
    this.refreshSettings()
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    if (el.type !== 'range') return
    el.style.setProperty('--fill', `${((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`)
    this.actions.settings({ [el.name]: Number(el.value) } as Partial<SaveData>)
  }

  private onKey(e: KeyboardEvent): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    if ((e.code === 'Escape' || e.code === 'Backspace') && this.screen === 'settings') {
      e.preventDefault()
      this.input.consume('pause')
      this.back()
      return
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault()
      this.moveFocus(e.code === 'ArrowDown' ? 1 : -1)
    }
  }

  frame(): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    if (this.input.consume('confirm') && this.input.method === 'gamepad') (document.activeElement as HTMLElement | null)?.click()
    if (this.input.consume('back') && this.screen === 'settings') this.back()
  }

  private navItems(): HTMLElement[] {
    const screen = this.q(`[data-screen="${this.screen}"]`)
    return [...screen.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => el.offsetParent !== null && !el.closest('.is-hidden'))
  }

  private moveFocus(dir: 1 | -1): void {
    const items = this.navItems()
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + dir + items.length) % items.length].focus()
  }

  private translate(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.i18n.t(el.dataset.i18n!)
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', this.i18n.t(el.dataset.i18nLabel!))
    this.cache.clear()
    document.title = this.i18n.t('game.title')
  }

  private set(slot: string, html: string): boolean {
    if (this.cache.get(slot) === html) return false
    this.cache.set(slot, html)
    for (const el of this.qa(`[data-slot="${slot}"]`)) el.textContent = html
    return true
  }
  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!
  }
  private qa<T extends HTMLElement = HTMLElement>(sel: string): T[] {
    return [...this.root.querySelectorAll<T>(sel)]
  }

  private timelineNodes(): string {
    const nodes: Array<[number, string]> = [
      [0, 'HQ'], [routeProgress(Z.stopLine), '拥堵'], [routeProgress(Z.track), '铁路'],
      [routeProgress(Z.convoyLane), 'Semi'], [routeProgress(LOOPS[0].zEntry), 'Plaid'], [routeProgress(FLIP.zStart), 'Flip'], [1, '家'],
    ]
    return nodes.map(([p, label]) => `<span class="tl-node" style="left:${(p * 100).toFixed(2)}%"><i></i><em>${label}</em></span>`).join('')
  }
  private gauge(sel: string, frac: number): void {
    const ARC = 207.35
    this.root.querySelector<SVGCircleElement>(`${sel} .g-val`)!.style.strokeDashoffset = String(ARC * (1 - Math.max(0, Math.min(1, frac))))
  }
  private controlsList(): string {
    const row = (keys: string, label: string) => `<li><span class="keys">${keys}</span><span data-i18n="${label}"></span></li>`
    return `<ul class="controls">
      ${row('<kbd>W</kbd><kbd>S</kbd>', 'controls.drive')}
      ${row('<kbd>A</kbd><kbd>D</kbd>', 'controls.steer')}
      ${row('<kbd class="wide">Shift</kbd>', 'controls.boost')}
      ${row('<kbd class="wide">Space</kbd>', 'controls.lift')}
      ${row('<kbd>Q</kbd><kbd>E</kbd>', 'controls.strafe')}
      ${row('<kbd>R</kbd>', 'controls.reset')}
      ${row('<kbd>Esc</kbd><kbd>P</kbd>', 'controls.pause')}
      ${row('<kbd>M</kbd>', 'controls.mute')}
    </ul>`
  }

  private template(): string {
    const range = (name: string, label: string) =>
      `<label class="row"><span data-i18n="${label}"></span><input data-nav type="range" name="${name}" min="0" max="1" step="0.05"></label>`
    const toggle = (setting: string, label: string) =>
      `<div class="row"><span data-i18n="${label}"></span><button data-nav class="toggle" data-setting="${setting}" aria-pressed="false"><i></i><span></span></button></div>`
    return /* html */ `
<section class="screen screen-boot is-active" data-screen="boot">
  <img class="boot-icon" src="/manus-storage/game/sha256/201cfe7f4a5e1de5489a198fb93015eec961286dd981dad8f223b1d69d918107.png" alt="" onerror="this.style.visibility='hidden'">
  <div class="boot-logo" data-i18n="game.title"></div>
  <div class="boot-bar"><i></i></div>
  <div class="boot-label" data-i18n="boot.loading"></div>
</section>
<section class="screen screen-title" data-screen="title">
  <div class="title-vignette"></div>
  <div class="title-block">
    <div class="logo"><div class="wordmark"><b>ROCKY</b><span class="wm-sep"></span><span data-i18n="game.wordmark"></span></div><h1 class="logo-text" data-i18n="game.title"></h1></div>
    <p class="tagline" data-i18n="game.tagline"></p>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="play"><span data-i18n="menu.play"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
    </nav>
    <p class="title-note" data-i18n="game.note"></p>
  </div>
  <aside class="title-controls panel">
    <h3 data-i18n="controls.title"></h3>
    ${this.controlsList()}
    <p class="controls-gas" data-i18n="controls.gas"></p>
  </aside>
  <footer class="bottom-bar"><div class="prompts"></div><small data-i18n="credits.fonts"></small></footer>
</section>
<section class="screen screen-hud" data-screen="hud">
  <div class="hud-objective"><small class="micro">STAGE <span data-slot="stageNo"></span></small><b data-slot="zone"></b><span data-slot="zoneHint"></span></div>
  <div class="hud-chips">
    <div class="chip chip-light is-hidden"><i></i><b data-slot="light"></b></div>
    <div class="chip chip-rail is-hidden"><i></i><b data-slot="rail"></b></div>
    <div class="chip chip-convoy is-hidden"><i></i><b data-slot="convoy"></b></div>
  </div>
  <div class="hud-clock"><small class="micro">T+</small><b data-slot="clock"></b><span class="sep"></span><small class="micro">HOME</small><b data-slot="home"></b></div>
  <div class="hud-buttons">
    <button class="hud-btn hud-mute" data-action="mute" data-i18n-label="touch.mute">${ICON.sound}</button>
    <button class="hud-btn hud-pause" data-action="pause" data-i18n-label="touch.pause">${ICON.pause}</button>
  </div>
  <div class="toast"></div>
  <div class="coach is-hidden"><small class="micro">TRAINING <span class="coach-no"></span> / 05</small><div class="coach-body"></div></div>
  <div class="hud-park is-hidden"><span data-i18n="hud.park"></span><div class="bar"><i></i></div></div>
  <div class="telemetry">
    <div class="gauge g-speed"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="g-track" cx="50" cy="50" r="44"/><circle class="g-val" cx="50" cy="50" r="44"/></svg><div class="g-read"><small>SPEED</small><b data-slot="kmh">0</b><em>KM/H</em></div></div>
    <div class="gauge g-alt"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="g-track" cx="50" cy="50" r="44"/><circle class="g-val" cx="50" cy="50" r="44"/></svg><div class="g-read"><small>ALTITUDE</small><b data-slot="altv">0</b><em>M</em></div></div>
  </div>
  <div class="timeline">
    <div class="tl-line"><i class="tl-fill"></i></div>
    ${this.timelineNodes()}
    <span class="tl-car"></span>
  </div>
  <div class="hud-gas">
    <div class="gas-head"><small class="micro">COLD GAS</small><span data-i18n="hud.gas"></span><b data-slot="gas"></b></div>
    <div class="gas-bar"><i class="gas-fill"></i></div>
    <div class="jets">
      <span class="jet jet-left">Q</span>
      <span class="jet jet-lift" data-i18n="hud.jet.lift"></span>
      <span class="jet jet-rear" data-i18n="hud.jet.rear"></span>
      <span class="jet jet-right">E</span>
    </div>
  </div>
  <div class="hud-help">${this.controlsList()}</div>
</section>
<section class="screen screen-pause screen-modal" data-screen="pause">
  <div class="modal">
    <h2 class="modal-title" data-i18n="pause.title"></h2>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="resume"><span data-i18n="menu.continue"></span></button>
      <button data-nav class="btn" data-action="restart"><span data-i18n="menu.restart"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="menu.quit"></span></button>
    </nav>
  </div>
</section>
<section class="screen screen-settings screen-modal" data-screen="settings">
  <div class="modal modal-wide">
    <h2 class="modal-title" data-i18n="settings.title"></h2>
    <div class="settings-grid">
      <fieldset><legend data-i18n="settings.audio"></legend>
        ${range('musicVolume', 'settings.music')}
        ${range('sfxVolume', 'settings.sfx')}
        ${toggle('muted', 'settings.mute')}
      </fieldset>
      <fieldset><legend data-i18n="settings.display"></legend>
        <div class="row"><span data-i18n="settings.quality"></span><div class="seg" data-setting="quality">
          <button data-nav data-value="low" data-i18n="settings.quality.low"></button><button data-nav data-value="medium" data-i18n="settings.quality.medium"></button><button data-nav data-value="high" data-i18n="settings.quality.high"></button>
        </div></div>
        ${toggle('reducedMotion', 'settings.reducedMotion')}
      </fieldset>
    </div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
</section>
<section class="screen screen-results screen-modal" data-screen="results">
  <div class="modal modal-results">
    <div class="results-kicker micro">MISSION COMPLETE · ROCKY</div>
    <h2 class="results-title modal-title" data-i18n="results.title"></h2>
    <p class="results-sub" data-i18n="results.sub"></p>
    <dl class="results-table">
      <div><dt data-i18n="results.time"></dt><dd class="r-time"></dd></div>
      <div><dt data-i18n="results.jam"></dt><dd class="r-jam"></dd></div>
      <div><dt data-i18n="results.rail"></dt><dd class="r-rail"></dd></div>
      <div><dt data-i18n="results.convoy"></dt><dd class="r-convoy"></dd></div>
      <div><dt data-i18n="results.stunt"></dt><dd class="r-stunt"></dd></div>
      <div><dt data-i18n="results.gas"></dt><dd class="r-gas"></dd></div>
      <div><dt data-i18n="results.landings"></dt><dd class="r-landings"></dd></div>
      <div><dt data-i18n="results.resets"></dt><dd class="r-resets"></dd></div>
    </dl>
    <nav class="menu menu-row">
      <button data-nav class="btn btn-primary" data-action="restart"><span data-i18n="results.again"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="results.toTitle"></span></button>
    </nav>
  </div>
</section>`
  }
}
