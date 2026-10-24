/**
 * Panorama girando da tela de título, montado com as 6 texturas do cubo.
 *
 * A rotação congela quando a janela está em segundo plano ou minimizada: é
 * animação puramente decorativa, e o WebKit agradece por não precisar compor
 * 6 texturas de 1024px sem ninguém olhando.
 */
import { useEffect, useState } from "react";
import { PANORAMA } from "../theme/assets";

export function Panorama({ overlay = true }: { overlay?: boolean }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const sync = () => setPaused(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return (
    <>
      <div className={`panorama ${paused ? "panorama--paused" : ""}`} aria-hidden>
        <div className="panorama__inner">
          {PANORAMA.map((face, i) => (
            <div
              key={i}
              className={`panorama__face panorama__face--${["right", "left", "top", "bottom", "front", "back"][i]}`}
              style={{ backgroundImage: `url(${face})` }}
            />
          ))}
        </div>
      </div>
      {overlay && <div className="mc-screen-tint" />}
    </>
  );
}
