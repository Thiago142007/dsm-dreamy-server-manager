/**
 * Editor de MOTD.
 *
 * Duas linhas (o limite do server.properties), com paleta de cores do jogo,
 * catálogo de emojis suportados pela fonte do Minecraft e alinhamento
 * automático (esquerda/centro/direita). A prévia usa a textura real da lista de
 * servidores do jogo.
 */
import { useEffect, useMemo, useState } from "react";
import { McButton } from "./McButton";
import { McText } from "./McText";

import { Motd } from "../lib/bridge";
import { TEX } from "../theme/assets";
import { EMOJI_GROUPS, ensureEmojiLoaded } from "../theme/emoji";
import { motdToHtml, stripFormatting } from "../lib/format";

/** Códigos de cor do Minecraft, na ordem do §0 ao §f. */
const COLORS: { code: string; label: string; hex: string }[] = [
  { code: "0", label: "Preto", hex: "#000000" },
  { code: "1", label: "Azul escuro", hex: "#0000aa" },
  { code: "2", label: "Verde escuro", hex: "#00aa00" },
  { code: "3", label: "Ciano escuro", hex: "#00aaaa" },
  { code: "4", label: "Vermelho escuro", hex: "#aa0000" },
  { code: "5", label: "Roxo escuro", hex: "#aa00aa" },
  { code: "6", label: "Dourado", hex: "#ffaa00" },
  { code: "7", label: "Cinza", hex: "#aaaaaa" },
  { code: "8", label: "Cinza escuro", hex: "#555555" },
  { code: "9", label: "Azul", hex: "#5555ff" },
  { code: "a", label: "Verde", hex: "#55ff55" },
  { code: "b", label: "Ciano", hex: "#55ffff" },
  { code: "c", label: "Vermelho", hex: "#ff5555" },
  { code: "d", label: "Rosa", hex: "#ff55ff" },
  { code: "e", label: "Amarelo", hex: "#ffff55" },
  { code: "f", label: "Branco", hex: "#ffffff" },
];

const FORMATS = [
  { code: "l", label: "Negrito" },
  { code: "o", label: "Itálico" },
  { code: "r", label: "Limpar" },
];

export type MotdAlignment = "left" | "center" | "right";

export interface MotdEditorProps {
  value: Motd;
  onChange: (motd: Motd) => void;
  /** nome do servidor, usado na prévia */
  serverName: string;
}

export function MotdEditor({ value, onChange, serverName }: MotdEditorProps) {
  const [activeLine, setActiveLine] = useState<0 | 1>(0);
  const [search, setSearch] = useState("");
  const [align, setAlign] = useState<MotdAlignment>("left");
  const [emojiReady, setEmojiReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void ensureEmojiLoaded().then(() => {
      if (alive) setEmojiReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const line = activeLine === 0 ? value.line1 : value.line2;
  const setLine = (text: string) =>
    onChange(activeLine === 0 ? { ...value, line1: text } : { ...value, line2: text });

  const insert = (text: string) => {
    setLine(line + text);
  };

  /** Aplica alinhamento com espaços, como o jogo faz nativamente. */
  const applyAlignment = (how: MotdAlignment) => {
    setAlign(how);
    if (how === "left") return;
    const total = 45; // largura útil aproximada de uma linha de MOTD
    const pad = Math.max(0, Math.floor((total - stripFormatting(line).length) / 2));
    const spaces = " ".repeat(pad);
    onChange(
      activeLine === 0
        ? { ...value, line1: spaces + line.trimStart() }
        : { ...value, line2: spaces + line.trimStart() },
    );
  };

  const emojis = useMemo(() => {
    if (!emojiReady) return [];
    const all = EMOJI_GROUPS.flatMap((g) => g.chars);
    if (!search.trim()) return all.slice(0, 160);
    const term = search.toLowerCase();
    return all.filter((ch) => ch.includes(term) || term.includes(ch)).slice(0, 160);
  }, [search]);

  return (
    <div className="motd-editor">
      <div className="motd-editor__palette">
        <span className="mc-field__label">Cor do texto</span>
        <div className="motd-editor__colors">
          {COLORS.map((c) => (
            <button
              key={c.code}
              className="motd-swatch"
              style={{ background: c.hex }}
              title={`${c.label} (§${c.code})`}
              onClick={() => insert(`§${c.code}`)}
            />
          ))}
        </div>
        <div className="mc-row mc-row--wrap" style={{ marginTop: 6 }}>
          {FORMATS.map((f) => (
            <McButton key={f.code} size="small" onClick={() => insert(`§${f.code}`)}>
              {f.label}
            </McButton>
          ))}
        </div>
      </div>

      <div className="motd-editor__lines">
        <div className="mc-row">
          <McButton
            size="small"
            variant={activeLine === 0 ? "primary" : "default"}
            onClick={() => setActiveLine(0)}
          >
            Linha 1
          </McButton>
          <McButton
            size="small"
            variant={activeLine === 1 ? "primary" : "default"}
            onClick={() => setActiveLine(1)}
          >
            Linha 2
          </McButton>
          <div className="mc-spacer" />
          <McButton size="small" onClick={() => applyAlignment("left")} title="Alinhar à esquerda">
            ⬅
          </McButton>
          <McButton
            size="small"
            onClick={() => applyAlignment("center")}
            title="Centralizar"
          >
            ↔
          </McButton>
          <McButton size="small" onClick={() => applyAlignment("right")} title="Alinhar à direita">
            ➡
          </McButton>
        </div>
        <textarea
          className="mc-textarea"
          value={line}
          rows={2}
          spellCheck={false}
          maxLength={120}
          onChange={(e) => setLine(e.target.value)}
          placeholder={activeLine === 0 ? "Primeira linha da descrição" : "Segunda linha"}
        />
        <span className="mc-hint">
          {stripFormatting(line).length}/120 caracteres nesta linha. Use "§" seguido de uma letra
          ou número para colorir (ex.: §aDeixa verde).
        </span>
      </div>

      <div className="motd-editor__emoji">
        <div className="mc-row">
          <span className="mc-field__label">Emojis suportados pelo Minecraft</span>
          <div className="mc-spacer" />
          <input
            className="mc-input"
            style={{ maxWidth: 180 }}
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="motd-editor__emoji-grid mc-scroll">
          {emojis.map((ch, i) => (
            <button
              key={`${ch}-${i}`}
              className="motd-emoji"
              title={`Inserir ${ch}`}
              onClick={() => insert(ch)}
            >
              {ch}
            </button>
          ))}
          {emojis.length === 0 && <span className="mc-hint">Nada encontrado.</span>}
        </div>
      </div>

      {/* prévia igual à lista de servidores do jogo */}
      <div className="motd-preview">
        <span className="mc-field__label">Prévia na lista de servidores</span>
        <div className="server-list-entry" style={{ backgroundImage: `url(${TEX.serverSelection})` }}>
          <div className="server-list-entry__icon">
            <McText scale={2}>?</McText>
          </div>
          <div className="server-list-entry__info">
            <div className="server-list-entry__name">{serverName}</div>
            <div className="server-list-entry__motd">
              <span
                dangerouslySetInnerHTML={{
                  __html: motdToHtml(value.line1 || "Linha 1"),
                }}
              />
              <br />
              <span
                dangerouslySetInnerHTML={{
                  __html: motdToHtml(value.line2 || "Linha 2"),
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mc-row">
        <span className="mc-hint">
          Também é possível colorir direto no servidor com comandos como /tellraw.
        </span>
      </div>
    </div>
  );
}

