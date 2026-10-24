/**
 * Renderizador da fonte bitmap do Minecraft.
 *
 * O jogo não usa uma fonte TTF: usa imagens com glifos de 8x8 (e 9x12 para os
 * acentuados), mapeando cada caractere para um recorte da textura. É assim que
 * conseguimos escrever "Configuração" com a aparência exata do jogo — inclusive
 * os acentos, que ficam em `accented.png`.
 */
import { FONTS } from "./assets";

type Glyph = { img: string; x: number; y: number; w: number; h: number };

/** Mapa de glifos: começa vazio e é preenchido por `ensureFontLoaded()`. */
const MAP: Record<string, Glyph> = {};
const IMAGES: Record<string, { w: number; h: number }> = {};
let loading: Promise<void> | null = null;

/**
 * Carrega `font-map.json` e `font-images.json` (gerados pelo
 * tools/copy-assets.mjs). Fica em cache no módulo; enquanto não carrega, os
 * textos saem com o fallback de largura.
 */
export function ensureFontLoaded(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const [map, images] = await Promise.all([
        fetch("/minecraft/fonts/font-map.json").then((r) => r.json()),
        fetch("/minecraft/fonts/font-images.json").then((r) => r.json()),
      ]);
      Object.assign(MAP, map);
      Object.assign(IMAGES, images);
    } catch {
      // sem o mapa, o McText cai no fallback (fonte monoespaçada)
    }
  })();
  return loading;
}

const URL_BY_NAME: Record<string, string> = {
  "ascii.png": FONTS.ascii,
  "accented.png": FONTS.accented,
  "nonlatin_european.png": FONTS.nonlatin,
};

/** Largura de um caractere em "pixels de glifo" (1 = o mesmo do jogo). */
export function glyphWidth(ch: string): number {
  const g = MAP[ch];
  return g ? g.w / 8 : 0.5;
}

/** Largura em pixels de escala (usada para alinhar MOTD e ícones). */
export function textWidth(text: string, scale: number): number {
  let units = 0;
  for (const ch of text) units += glyphWidth(ch);
  return units * 8 * scale;
}

export type GlyphRender = {
  ch: string;
  style: React.CSSProperties;
  /** false quando o caractere não existe na fonte do jogo */
  known: boolean;
};

/** Converte um texto nos glifos renderizáveis. */
export function toGlyphs(text: string, scale: number): GlyphRender[] {
  const out: GlyphRender[] = [];
  for (const ch of text) {
    const g = MAP[ch];
    if (!g) {
      out.push({ ch, style: {}, known: false });
      continue;
    }
    const img = URL_BY_NAME[g.img];
    const dims = IMAGES[g.img];
    out.push({
      ch,
      known: true,
      style: {
        width: `${g.w * scale}px`,
        height: `${g.h * scale}px`,
        backgroundImage: `url(${img})`,
        backgroundSize: `${dims.w * scale}px ${dims.h * scale}px`,
        backgroundPosition: `${-g.x * scale}px ${-g.y * scale}px`,
      },
    });
  }
  return out;
}

/** Quebra o texto em linhas de no máximo `maxUnits` de largura. */
export function wrapText(text: string, maxUnits: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    let width = 0;
    for (const word of paragraph.split(/(\s+)/)) {
      const wordWidth = [...word].reduce((sum, ch) => sum + glyphWidth(ch), 0);
      if (width + wordWidth > maxUnits && current.trim() !== "") {
        lines.push(current.trimEnd());
        current = "";
        width = 0;
      }
      current += word;
      width += wordWidth;
    }
    lines.push(current.trimEnd());
  }
  return lines;
}
