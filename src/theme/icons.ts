/**
 * Resolução de ícones de itens e blocos.
 *
 * As texturas ficam em `public/minecraft/icons/` (copiadas do jogo pelo
 * tools/copy-assets.mjs) e o Vite as publica na raiz do app sem renomear. O
 * arquivo `index.json` ao lado lista todos os nomes, então é possível pedir o
 * ícone de `minecraft:diamond_sword` e receber `/minecraft/icons/items/diamond_sword.png`
 * — inclusive offline, sem depender de nenhum CDN.
 */

const ITEM_PREFIX = "/minecraft/icons/items/";
const BLOCK_PREFIX = "/minecraft/icons/blocks/";

/** Nomes conhecidos, preenchidos por `ensureIconsLoaded()`. */
const itemIndex = new Set<string>();
const blockIndex = new Set<string>();
let loading: Promise<void> | null = null;

/** Carrega a lista de ícones (gerada pelo tools/copy-assets.mjs). */
export function ensureIconsLoaded(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const names: { items: string[]; blocks: string[] } = await fetch(
        "/minecraft/icons/index.json",
      ).then((r) => r.json());
      for (const name of names.items ?? []) itemIndex.add(name);
      for (const name of names.blocks ?? []) blockIndex.add(name);
    } catch {
      // sem a lista, `itemIcon` devolve null e a interface mostra o nome do item
    }
  })();
  return loading;
}

/** URL do ícone de um item (`minecraft:diamond_sword`) ou null se não existir. */
export function itemIcon(id: string): string | null {
  if (!id) return null;
  const name = String(id).replace("minecraft:", "").trim();
  if (itemIndex.has(name)) return `${ITEM_PREFIX}${name}.png`;
  if (blockIndex.has(name)) return `${BLOCK_PREFIX}${name}.png`;
  // itens de bloco usam a textura do bloco: "oak_button" -> tenta "oak_planks"
  const prefix = name.split("_")[0];
  for (const key of blockIndex) {
    if (key.startsWith(prefix) && key.endsWith(name)) {
      return `${BLOCK_PREFIX}${key}.png`;
    }
  }
  return null;
}

/** Quantos ícones estão disponíveis (usado na tela de informações). */
export function iconCount(): number {
  return itemIndex.size + blockIndex.size;
}
