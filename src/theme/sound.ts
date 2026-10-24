/**
 * Motor de sons.
 *
 * Usa os arquivos .ogg originais do jogo (copiados do .minecraft do usuário) e
 * toca via WebAudio, com o mesmo volume/variação aleatória que o Minecraft usa
 * nos cliques de botão.
 */
import { SOUNDS, type SoundName } from "./assets";

type Cache = Map<string, AudioBuffer>;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private buffers: Cache = new Map();
  private enabled = true;
  private volume = 0.55;
  private failed = new Set<string>();

  private ensureCtx(): AudioContext | null {
    if (this.failed.size > 0 && this.failed.size >= 3) return null;
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  get isEnabled() {
    return this.enabled;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
  }

  /** Carrega (e memoriza) um som. */
  async load(name: SoundName): Promise<AudioBuffer | null> {
    const url = SOUNDS[name];
    if (this.buffers.has(url)) return this.buffers.get(url)!;
    const ctx = this.ensureCtx();
    if (!ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(raw);
      this.buffers.set(url, buffer);
      return buffer;
    } catch {
      this.failed.add(url);
      return null;
    }
  }

  /**
   * Toca um som. `pitchVariance` imita o jogo, que varia levemente o tom entre
   * cliques para não ficar robotizado.
   */
  play(name: SoundName, opts: { volume?: number; pitchVariance?: number } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    void this.load(name).then((buffer) => {
      if (!buffer || !this.ctx) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const variance = opts.pitchVariance ?? 0;
      if (variance > 0) {
        source.playbackRate.value = 1 + (Math.random() * 2 - 1) * variance;
      }
      const gain = this.ctx.createGain();
      gain.gain.value = (opts.volume ?? 1) * this.volume;
      source.connect(gain).connect(this.ctx.destination);
      source.start();
    });
  }
}

export const sfx = new SoundEngine();

/** Nomes usados pela interface, com o volume típico de cada um. */
export const UI = {
  click: () => sfx.play("click", { pitchVariance: 0.06 }),
  hover: () => sfx.play("pop", { volume: 0.25 }),
  back: () => sfx.play("bass", { volume: 0.35 }),
  error: () => sfx.play("bass", { volume: 0.5 }),
  success: () => sfx.play("levelup", { volume: 0.6 }),
  pop: () => sfx.play("pop", { volume: 0.8 }),
  chestOpen: () => sfx.play("chestOpen", { volume: 0.7 }),
  chestClose: () => sfx.play("chestClose", { volume: 0.7 }),
  serverUp: () => sfx.play("levelup", { volume: 0.7 }),
  serverDown: () => sfx.play("fizz", { volume: 0.6 }),
  kill: () => sfx.play("bowHit", { volume: 0.7 }),
  ban: () => sfx.play("anvil", { volume: 0.6 }),
  build: () => sfx.play("woodClick", { volume: 0.5 }),
} as const;

export type UiSound = keyof typeof UI;

/** Liga/desliga todos os sons (aba Opções do app / atalho). */
export function soundsEnabled(on: boolean) {
  sfx.setEnabled(on);
}
