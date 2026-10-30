import type { Quality } from '../render/GameRenderer';
import { readHeader, type SaveHeader } from '../sim/save';

export interface Settings {
  quality: Quality;
  tiltShift: boolean;
  reducedMotion: boolean;
  /** 0..1 */
  volume: number;
  muted: boolean;
}

const SETTINGS_KEY = 'omen.settings';
const SAVE_KEY = 'omen.save';

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaults(): Settings {
  const touch = matchMedia('(pointer: coarse)').matches;
  return {
    quality: touch ? 'medium' : 'high',
    tiltShift: true,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    volume: 0.6,
    muted: false,
  };
}

export function loadSettings(): Settings {
  const d = defaults();
  try {
    const raw = store()?.getItem(SETTINGS_KEY);
    return raw ? { ...d, ...(JSON.parse(raw) as Partial<Settings>) } : d;
  } catch {
    return d;
  }
}

function saveSettings(s: Settings): void {
  try {
    store()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: settings last for this visit only.
  }
}

// ---------------------------------------------------------------- the save slot

export function readSave(): string | null {
  try {
    return store()?.getItem(SAVE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function savedHeader(): SaveHeader | null {
  const text = readSave();
  return text ? readHeader(text) : null;
}

/** Write the save slot; returns an error message, or null on success. */
export function writeSave(text: string): string | null {
  const s = store();
  if (!s) return 'Saving is blocked in this browser.';
  try {
    s.setItem(SAVE_KEY, text);
    return null;
  } catch {
    return 'Not enough storage space to save.';
  }
}

export function deleteSave(): void {
  try {
    store()?.removeItem(SAVE_KEY);
  } catch {
    // nothing to do
  }
}

// ---------------------------------------------------------------- panel

const QUALITIES: Quality[] = ['low', 'medium', 'high'];

/** Settings (SPEC M7): graphics quality, tilt-shift, reduced motion, sound, and the save slot. */
export class SettingsPanel {
  readonly el: HTMLElement;
  private status = '';

  constructor(
    root: HTMLElement,
    readonly settings: Settings,
    private readonly apply: (s: Settings) => void,
    private readonly saveNow: (() => string | null) | null,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel settings-panel';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) return this.toggle(false);
      const q = t.closest<HTMLElement>('[data-quality]')?.dataset.quality as Quality | undefined;
      if (q) this.set({ quality: q });
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'save' && this.saveNow) {
        const err = this.saveNow();
        this.status = err ?? 'Saved.';
        this.render();
      } else if (a === 'delete') {
        deleteSave();
        this.status = 'Save deleted.';
        this.render();
      }
    });
    this.el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'tilt') this.set({ tiltShift: t.checked });
      else if (t.name === 'motion') this.set({ reducedMotion: t.checked });
      else if (t.name === 'mute') this.set({ muted: t.checked });
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'volume') this.set({ volume: Number(t.value) / 100 }, false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyT') this.set({ tiltShift: !this.settings.tiltShift });
      if (e.code === 'KeyM') this.set({ muted: !this.settings.muted });
    });
    apply(settings);
  }

  set(patch: Partial<Settings>, rerender = true): void {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    this.apply(this.settings);
    if (rerender && !this.el.hidden) this.render();
  }

  toggle(show = this.el.hidden): void {
    this.el.hidden = !show;
    this.status = '';
    if (show) this.render();
  }

  private render(): void {
    const s = this.settings;
    const h = savedHeader();
    const check = (name: string, on: boolean, label: string, hint = '') =>
      `<label class="st-check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    this.el.innerHTML = `
      <button class="ins-close" data-close aria-label="Close">×</button>
      <h2>Settings</h2>
      <div class="st-row"><span>Graphics</span><div class="st-seg">${QUALITIES.map((q) => `<button data-quality="${q}" class="${q === s.quality ? 'active' : ''}">${q[0]!.toUpperCase() + q.slice(1)}</button>`).join('')}</div></div>
      ${check('tilt', s.tiltShift, 'Tilt-shift', 'The miniature blur (T)')}
      ${check('motion', s.reducedMotion, 'Reduced motion', 'No camera shake, softer flashes, calmer UI')}
      <div class="st-row"><span>Sound</span><input type="range" name="volume" min="0" max="100" value="${Math.round(s.volume * 100)}" aria-label="Volume"></div>
      ${check('mute', s.muted, 'Mute', 'M')}
      <h3>Game</h3>
      <div class="st-save">${h ? `Saved: ${h.mode === 'warning' ? 'The Warning' : 'Sandbox'}, ${h.label}` : 'No save yet.'} <small>Autosaves every year.</small></div>
      <div class="st-actions">
        ${this.saveNow ? '<button data-a="save">Save now</button>' : ''}
        ${h ? '<button data-a="delete">Delete save</button>' : ''}
      </div>
      ${this.status ? `<div class="st-status">${this.status}</div>` : ''}`;
  }
}
