/** Ícone de bloco por software (usado em várias abas). */
import { ICONS } from "../../theme/assets";

const MAP: Record<string, string> = {
  vanilla: ICONS.grass,
  paper: ICONS.grass,
  purpur: ICONS.grass,
  spigot: ICONS.cobblestone,
  quilt: ICONS.planks,
  mohist: ICONS.cobblestone,
  bungeecord: ICONS.planks,
  pocketmine: ICONS.planks,
  bedrock: ICONS.grass,
  velocity: ICONS.planks,
  fabric: ICONS.diamond,
  magma: ICONS.stone,
  neoforge: ICONS.stone,
  forge: ICONS.stone,
  archlight: ICONS.stone,
  modpack: ICONS.diamond,
};

export function softwareIcon(id: string): string {
  return MAP[id] ?? ICONS.dirt;
}
