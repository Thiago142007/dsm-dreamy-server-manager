/**
 * Janela modal no estilo dos diálogos do Minecraft (fundo escuro, borda preta).
 */
import { useEffect, useRef } from "react";
import { McButton } from "./McButton";
import { UI } from "../theme/sound";

export interface ModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  /** texto do botão de confirmar; se omitido, não aparece */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose: () => void;
  confirmDisabled?: boolean;
  destructive?: boolean;
  width?: number;
  /** conteúdo extra no rodapé (ex.: checkbox "apagar tudo") */
  footer?: React.ReactNode;
}

export function Modal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  onConfirm,
  onClose,
  confirmDisabled,
  destructive,
  width = 520,
  footer,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-window mc-panel"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-window__title">{title}</div>
        <div className="modal-window__body mc-scroll">{children}</div>
        <div className="modal-window__footer">
          {footer}
          <div className="mc-spacer" />
          <McButton size="small" onClick={onClose}>
            {cancelLabel}
          </McButton>
          {confirmLabel && (
            <McButton
              size="small"
              variant={destructive ? "danger" : "primary"}
              disabled={confirmDisabled}
              onClick={() => {
                UI.click();
                onConfirm?.();
              }}
            >
              {confirmLabel}
            </McButton>
          )}
        </div>
      </div>
    </div>
  );
}
