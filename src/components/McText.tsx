/**
 * Texto na fonte bitmap do Minecraft.
 *
 * Cada caractere é um <span> com um recorte da textura do jogo — é assim que o
 * Minecraft desenha texto, então acentos e símbolos saem perfeitos.
 *
 * O mapa de glifos é carregado por fetch (public/minecraft/fonts/font-map.json),
 * então o componente espera esse carregamento antes de desenhar. Enquanto isso,
 * o texto aparece com a fonte monoespaçada de fallback.
 */
import { memo, useEffect, useState } from "react";
import { ensureFontLoaded, toGlyphs, textWidth } from "../theme/font";

export interface McTextProps {
  children: string;
  /** escala do glifo (2 = 16px, o mesmo do jogo em GUI scale 2) */
  scale?: number;
  /** sombra como no jogo (liga/desliga) */
  shadow?: boolean;
  className?: string;
  /** cor CSS — por padrão branco */
  color?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  title?: string;
}

/** Fallback quando o mapa ainda não carregou: fonte monoespaçada do sistema. */
function glyphFallback(ch: string, key: number) {
  return (
    <span className="mc-glyph" key={`f${key}`} style={{ width: "auto", minWidth: "0.6em" }}>
      {ch}
    </span>
  );
}

export const McText = memo(function McText({
  children,
  scale = 2,
  shadow = true,
  className = "",
  color,
  style,
  onClick,
  title,
}: McTextProps) {
  const text = children ?? "";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void ensureFontLoaded().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const glyphs = ready ? toGlyphs(text, scale) : null;

  return (
    <span
      className={`mc-text ${shadow ? "" : "mc-text--plain"} ${className}`}
      style={{ color, fontSize: `${8 * scale}px`, ...style }}
      onClick={onClick}
      title={title}
    >
      {[...text].map((ch, i) => {
        if (glyphs) {
          const g = glyphs[i];
          if (!g.known) return glyphFallback(ch, i);
          return <span key={i} className="mc-glyph" style={g.style} aria-hidden />;
        }
        return glyphFallback(ch, i);
      })}
    </span>
  );
});

/** Mede a largura de um texto na escala indicada (para centralizar MOTD). */
export function measure(text: string, scale = 2) {
  return textWidth(text, scale);
}
