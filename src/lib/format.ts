/** Formatação de valores para a interface. */
import { ServerStatus } from "./bridge";

export function humanBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function statusLabel(status: ServerStatus): string {
  switch (status) {
    case "online":
      return "Online";
    case "starting":
      return "Iniciando...";
    case "stopping":
      return "Parando...";
    default:
      return "Offline";
  }
}

export function statusColor(status: ServerStatus): string {
  switch (status) {
    case "online":
      return "var(--mc-green)";
    case "starting":
      return "var(--mc-yellow)";
    case "stopping":
      return "var(--mc-gold)";
    default:
      return "var(--mc-red)";
  }
}

/** Data no formato brasileiro a partir de um ISO ou nome de backup. */
export function formatDate(value: string): string {
  if (!value) return "—";
  // nomes de backup: 2026-10-10_14-30-00
  if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/.test(value)) {
    const [date, time] = value.replace(/\.tar\.gz$/, "").split("_");
    const [y, m, d] = date.split("-");
    return `${d}/${m}/${y} às ${time.replace(/-/g, ":")}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** IP mostrado no cabeçalho da aba Server. */
export function serverAddress(port: number): string {
  return `127.0.0.1:${port}`;
}

/** RAM em GB/MB. */
export function formatRam(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb % 1 === 0 ? gb : gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

/** Converte códigos de cor §a em CSS, para exibir MOTD no painel. */
const SECTION_TO_CSS: Record<string, string> = {
  "0": "#000000", "1": "#0000aa", "2": "#00aa00", "3": "#00aaaa",
  "4": "#aa0000", "5": "#aa00aa", "6": "#ffaa00", "7": "#aaaaaa",
  "8": "#555555", "9": "#5555ff", a: "#55ff55", b: "#55ffff",
  c: "#ff5555", d: "#ff55ff", e: "#ffff55", f: "#ffffff",
};

export function motdToHtml(motd: string): string {
  const escaped = motd
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let current = "#ffffff";
  let bold = false;
  let italic = false;
  const out: string[] = [];
  const parts = escaped.split(/(§[0-9a-fk-or])/g);
  for (const part of parts) {
    const match = /^§([0-9a-fk-or])$/.exec(part);
    if (match) {
      const code = match[1];
      if (SECTION_TO_CSS[code]) current = SECTION_TO_CSS[code];
      if (code === "k") continue;
      if (code === "l") bold = true;
      if (code === "o") italic = true;
      if (code === "r") {
        current = "#ffffff";
        bold = false;
        italic = false;
      }
      continue;
    }
    if (!part) continue;
    const style = [
      `color:${current}`,
      bold ? "font-weight:bold" : "",
      italic ? "font-style:italic" : "",
    ]
      .filter(Boolean)
      .join(";");
    out.push(`<span style="${style}">${part}</span>`);
  }
  return out.join("");
}

/** Remove códigos de formatação para contagem de caracteres. */
export function stripFormatting(text: string): string {
  return text.replace(/§[0-9a-fk-or]/g, "");
}

/** Nome de arquivo seguro (sem barras). */
export function safeFileName(name: string, fallback = "arquivo"): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, "-").trim();
  return clean.length ? clean : fallback;
}

/** Corta uma descrição no número de caracteres informado. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}...`;
}

/** Extrai a versão "1.21.4" de "1.21.4-47.1.3" (forge). */
export function mcVersionOf(raw: string): string {
  const match = /^(\d+\.\d+(\.\d+)?)/.exec(raw);
  return match ? match[1] : raw;
}
