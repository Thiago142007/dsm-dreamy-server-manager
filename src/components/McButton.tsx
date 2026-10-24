/**
 * Botão no estilo do Minecraft: textura 9-slice, som de clique e hover.
 */
import { forwardRef } from "react";
import { UI } from "../theme/sound";

export interface McButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "danger" | "primary";
  size?: "small" | "normal" | "large";
  wide?: boolean;
  /** toca o som de clique do jogo */
  sound?: boolean;
}

export const McButton = forwardRef<HTMLButtonElement, McButtonProps>(function McButton(
  { variant = "default", size = "normal", wide, sound = true, className = "", onClick, children, ...rest },
  ref,
) {
  const classes = [
    "mc-btn",
    variant === "danger" ? "mc-btn--danger" : "",
    variant === "primary" ? "mc-btn--primary" : "",
    size === "small" ? "mc-btn--small" : "",
    size === "large" ? "mc-btn--large" : "",
    wide ? "mc-btn--wide" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      className={classes}
      onClick={(e) => {
        if (!rest.disabled) {
          if (sound) UI.click();
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
});
