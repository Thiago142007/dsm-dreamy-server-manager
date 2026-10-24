/**
 * Botão de escolha do ícone do servidor.
 *
 * O redimensionamento para 64x64 é feito no backend (crate `image`), que é o
 * tamanho máximo aceito pelo server-icon.png do Minecraft.
 */
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/bridge";
import { McButton } from "./McButton";
import { McText } from "./McText";
import { useToast } from "./Toast";
import { TEX, ICONS } from "../theme/assets";
import { UI } from "../theme/sound";

export interface IconUploadProps {
  /** caminho do ícone atual, relativo à pasta do servidor */
  current: string | null;
  serverId?: string;
  /** chamado com o caminho absoluto do arquivo escolhido */
  onPick?: (absolutePath: string) => void;
  size?: number;
  /** no modo "criar servidor" não existe servidor ainda */
  readOnly?: boolean;
}

export function IconUpload({ current, serverId, onPick, size = 96, readOnly }: IconUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  const pick = async () => {
    UI.click();
    try {
      const selected = await open({
        multiple: false,
        title: "Escolha a imagem do servidor",
        filters: [
          { name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
        ],
      });
      if (typeof selected !== "string") return;
      setBusy(true);
      if (serverId) {
        await api.setServerIcon(serverId, selected);
        setPreview(null);
        notify("Ícone atualizado (64x64).", "success");
      } else if (onPick) {
        // modo criação: guarda só o caminho; o Rust redimensiona ao criar
        onPick(selected);
        setPreview(selected);
      }
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  /** Só a prévia local (criação) ou o ícone já salvo no servidor. */
  const shown = preview;

  return (
    <div className="icon-upload">
      <button className="icon-upload__box" onClick={pick} disabled={busy || readOnly} title="Clique para escolher uma imagem">
        {shown ? (
          <img src={shown} alt="Ícone do servidor" />
        ) : (
          <div className="icon-upload__placeholder">
            <img src={ICONS.dirt} alt="" className="icon-upload__dirt" />
            <span className="icon-upload__plus">+</span>
          </div>
        )}
      </button>
      <McText scale={1.6} className="icon-upload__label">
        Logo
      </McText>
      {!readOnly && (
        <>
          <McButton size="small" onClick={pick} disabled={busy}>
            {busy ? "Ajustando..." : "Escolher imagem"}
          </McButton>
          <span className="mc-hint">Opcional. O app corta e redimensiona para 64x64.</span>
        </>
      )}
    </div>
  );
}
