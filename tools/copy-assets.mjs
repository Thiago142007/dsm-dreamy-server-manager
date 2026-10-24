#!/usr/bin/env node
/**
 * copy-assets.mjs — extrai do .minecraft do usuário apenas os assets que a UI do DSM precisa
 * (manifest curado) e copia para src/assets/minecraft/.
 *
 * Uso:  node tools/copy-assets.mjs
 *
 * Por que um manifest curado: o índice de assets tem 5.147 entradas e o jar do cliente
 * tem 34.227 arquivos. A UI só precisa de ~70 arquivos (fontes, sprites de widget,
 * fundos, ícones de bloco/item e ~18 sons). Copiar tudo pesaria ~1,4 GB sem uso.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";

const MINECRAFT = join(homedir(), ".minecraft");
const OUT = join(process.cwd(), "public", "minecraft");

/** jars que serão usados como fonte (ordem = prioridade) */
const JAR_DIRS = readdirSync(join(MINECRAFT, "versions"))
  .map((v) => join(MINECRAFT, "versions", v, `${v}.jar`))
  .filter(existsSync)
  .map((p) => ({ dir: dirname(p), jar: p, files: jarEntries(p) }));

const JAR_263 = pickJar("26.3") ?? pickNewest();
const JAR_1165 = pickJar("OptiFine 1.16.5") ?? pickNewest();

/** índice de sons/objetos mais recente */
const INDEX_DIR = join(MINECRAFT, "assets", "indexes");
const INDEX_FILE = pickNewestIndex();
const INDEX = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
const OBJECTS = join(MINECRAFT, "assets", "objects");

// ---------------------------------------------------------------- manifest
/** [destino no projeto, caminho dentro do jar] */
const FROM_JARS = [
  // ---- fonte bitmap (16x16 glifos, renderizada igual ao jogo) ----
  ["fonts/ascii.png", "assets/minecraft/textures/font/ascii.png"],
  ["fonts/accented.png", "assets/minecraft/textures/font/accented.png"],
  ["fonts/nonlatin_european.png", "assets/minecraft/textures/font/nonlatin_european.png"],
  ["fonts/default.json", "assets/minecraft/font/include/default.json"],

  // ---- sprites de widget (botões, scroll, slots) ----
  ["gui/widgets/button.png", "assets/minecraft/textures/gui/sprites/widget/button.png"],
  ["gui/widgets/button_highlighted.png", "assets/minecraft/textures/gui/sprites/widget/button_highlighted.png"],
  ["gui/widgets/button_disabled.png", "assets/minecraft/textures/gui/sprites/widget/button_disabled.png"],
  ["gui/widgets/scroller.png", "assets/minecraft/textures/gui/sprites/widget/scroller.png"],
  ["gui/widgets/scroller_background.png", "assets/minecraft/textures/gui/sprites/widget/scroller_background.png"],
  ["gui/widgets/tab.png", "assets/minecraft/textures/gui/sprites/widget/tab.png"],
  ["gui/widgets/tab_selected.png", "assets/minecraft/textures/gui/sprites/widget/tab_selected.png"],
  ["gui/widgets/tab_selected_highlighted.png", "assets/minecraft/textures/gui/sprites/widget/tab_selected_highlighted.png"],
  ["gui/widgets/slot_frame.png", "assets/minecraft/textures/gui/sprites/widget/slot_frame.png"],
  ["gui/container/slot.png", "assets/minecraft/textures/gui/sprites/container/slot.png"],
  ["gui/container/inventory.png", "assets/minecraft/textures/gui/container/inventory.png"],
  ["gui/header_separator.png", "assets/minecraft/textures/gui/header_separator.png"],
  ["gui/footer_separator.png", "assets/minecraft/textures/gui/footer_separator.png"],
  ["gui/menu_list_background.png", "assets/minecraft/textures/gui/menu_list_background.png"],
  ["gui/inworld_menu_list_background.png", "assets/minecraft/textures/gui/inworld_menu_list_background.png"],

  // ---- ícone padrão de servidor (bloco de terra, como no jogo) ----
  ["icons/dirt.png", "assets/minecraft/textures/block/dirt.png"],
  ["icons/grass_block_top.png", "assets/minecraft/textures/block/grass_block_top.png"],
  ["icons/stone.png", "assets/minecraft/textures/block/stone.png"],
  ["icons/cobblestone.png", "assets/minecraft/textures/block/cobblestone.png"],
  ["icons/oak_planks.png", "assets/minecraft/textures/block/oak_planks.png"],
  ["icons/diamond.png", "assets/minecraft/textures/item/diamond.png"],
];

/** [destino, caminho dentro do jar antigo] — texturas que só existem em versões antigas */
const FROM_OLD_JAR = [
  // ---- fundo da lista de servidores do multiplayer (retângulo marrom) ----
  ["gui/server_selection.png", "assets/minecraft/textures/gui/server_selection.png"],
  // ---- fundo dos menus / tile de opções ----
  ["gui/options_background.png", "assets/minecraft/textures/gui/options_background.png"],
];

/** [destino, chave no índice de assets] — sons + panorama */
const FROM_INDEX = [
  ["sounds/click.ogg", "minecraft/sounds/random/click.ogg"],
  ["sounds/click_stereo.ogg", "minecraft/sounds/random/click_stereo.ogg"],
  ["sounds/pop.ogg", "minecraft/sounds/random/pop.ogg"],
  ["sounds/levelup.ogg", "minecraft/sounds/random/levelup.ogg"],
  ["sounds/orb.ogg", "minecraft/sounds/random/orb.ogg"],
  ["sounds/fizz.ogg", "minecraft/sounds/random/fizz.ogg"],
  ["sounds/glass1.ogg", "minecraft/sounds/random/glass1.ogg"],
  ["sounds/explode1.ogg", "minecraft/sounds/random/explode1.ogg"],
  ["sounds/bass.ogg", "minecraft/sounds/note/bass.ogg"],
  ["sounds/successful_hit.ogg", "minecraft/sounds/random/successful_hit.ogg"],
  ["sounds/anvil_land.ogg", "minecraft/sounds/random/anvil_land.ogg"],
  ["sounds/chestopen.ogg", "minecraft/sounds/random/chestopen.ogg"],
  ["sounds/chestclosed.ogg", "minecraft/sounds/random/chestclosed.ogg"],
  ["sounds/bowhit1.ogg", "minecraft/sounds/random/bowhit1.ogg"],
  ["sounds/burp.ogg", "minecraft/sounds/random/burp.ogg"],
  ["sounds/wood_click.ogg", "minecraft/sounds/random/wood_click.ogg"],
  ["gui/panorama_0.png", "minecraft/textures/gui/title/background/panorama_0.png"],
  ["gui/panorama_1.png", "minecraft/textures/gui/title/background/panorama_1.png"],
  ["gui/panorama_2.png", "minecraft/textures/gui/title/background/panorama_2.png"],
  ["gui/panorama_3.png", "minecraft/textures/gui/title/background/panorama_3.png"],
  ["gui/panorama_4.png", "minecraft/textures/gui/title/background/panorama_4.png"],
  ["gui/panorama_5.png", "minecraft/textures/gui/title/background/panorama_5.png"],
  ["gui/panorama_overlay.png", "minecraft/textures/gui/title/background/panorama_overlay.png"],
];

// ---------------------------------------------------------------- helpers
function exists(p) { return existsSync(p); }
function jarEntries(jar) {
  try {
    const out = execFileSync("unzip", ["-Z1", jar], { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
    return new Set(out.split("\n").filter(Boolean));
  } catch { return new Set(); }
}
function pickJar(name) {
  const p = join(MINECRAFT, "versions", name, `${name}.jar`);
  if (!exists(p)) return null;
  return { dir: join(MINECRAFT, "versions", name), jar: p, files: jarEntries(p) };
}
function pickNewest() {
  const dirs = readdirSync(join(MINECRAFT, "versions"))
    .map((v) => join(MINECRAFT, "versions", v, `${v}.jar`))
    .filter(exists)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!dirs.length) throw new Error("nenhum jar encontrado em ~/.minecraft/versions");
  return { dir: dirname(dirs[0]), jar: dirs[0], files: jarEntries(dirs[0]) };
}
function pickNewestIndex() {
  const f = readdirSync(INDEX_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(INDEX_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return f;
}
function extractFromJar(jar, inner, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync("bash", ["-c", `unzip -p ${JSON.stringify(jar)} ${JSON.stringify(inner)} > ${JSON.stringify(dest)}`]);
}
function extractFromIndex(key, dest) {
  const entry = INDEX.objects[key];
  if (!entry) throw new Error(`chave ausente no índice: ${key}`);
  const src = join(OBJECTS, entry.hash.slice(0, 2), entry.hash);
  if (!exists(src)) throw new Error(`objeto ausente no disco: ${src} (baixe a versão no launcher)`);
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync("cp", [src, dest]);
}

// ---------------------------------------------------------------- mapa de glifos
// A fonte do Minecraft é bitmap: cada provider declara uma imagem e a lista de
// caracteres de cada linha. Daí dá para montar o mapa codepoint -> recorte.
function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * Monta `fonts/font-map.json`:
 *   { "á": { "img": "accented.png", "x":.., "y":.., "w":.., "h":.. }, ... }
 * Também grava `fonts/font-images.json` com as dimensões de cada imagem, para
 * o renderizador poder calcular o background-size.
 */
/**
 * Lista os ícones disponíveis em `icons/index.json`, para o frontend poder
 * resolver `/minecraft/icons/items/<nome>.png` sem saber o que existe.
 */
function buildIconIndex() {
  const list = (dir) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""));
  };
  const index = {
    items: list(join(OUT, "icons", "items")),
    blocks: list(join(OUT, "icons", "blocks")),
  };
  writeFileSync(join(OUT, "icons", "index.json"), JSON.stringify(index));
  console.log(`▸ índice de ícones: ${index.items.length} itens, ${index.blocks.length} blocos`);
}

function buildFontMap() {
  const def = JSON.parse(readFileSync(join(OUT, "fonts/default.json"), "utf8"));
  const map = {};
  const images = {};
  for (const provider of def.providers) {
    if (provider.type !== "bitmap" || !provider.file) continue;
    const name = provider.file.replace("minecraft:font/", "");
    const imgPath = join(OUT, "fonts", name);
    if (!existsSync(imgPath)) {
      console.log(`     (imagem ausente, provider ignorado: ${name})`);
      continue;
    }
    const { w, h } = pngSize(imgPath);
    images[name] = { w, h };
    const rows = provider.chars ?? [];
    if (!rows.length) continue;
    const cols = rows[0].length;
    const cellW = w / cols;
    const cellH = h / rows.length;
    if (!Number.isInteger(cellW) || !Number.isInteger(cellH)) {
      console.log(`     (grade não inteira em ${name}: ${w}x${h} em ${cols}x${rows.length})`);
      continue;
    }
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        map[ch] = { img: name, x: c * cellW, y: r * cellH, w: cellW, h: cellH };
      });
    });
  }
  writeFileSync(join(OUT, "fonts/font-map.json"), JSON.stringify(map));
  writeFileSync(join(OUT, "fonts/font-images.json"), JSON.stringify(images));
  console.log(`▸ mapa de glifos: ${Object.keys(map).length} caracteres em ${Object.keys(images).length} imagens`);
}

// ---------------------------------------------------------------- extras
/**
 * Ícones de itens (usados no editor de inventário). Ficam em icons/items/ e são
 * resolvidos por nome no frontend: `diamond_sword` -> icons/items/diamond_sword.png
 */
function extractItemIcons() {
  const tmp = join(OUT, ".tmp-items");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    execFileSync("bash", [
      "-c",
      `unzip -o -q ${JSON.stringify(JAR_263.jar)} 'assets/minecraft/textures/item/*' 'assets/minecraft/textures/block/*' -d ${JSON.stringify(tmp)}`,
    ]);
  } catch {
    console.log("     (sem ícones de item no jar)");
    removeSync(tmp, { recursive: true, force: true });
    return;
  }
  const src = join(tmp, "assets", "minecraft", "textures", "item");
  const dest = join(OUT, "icons", "items");
  mkdirSync(dest, { recursive: true });
  let count = 0;
  if (existsSync(src)) {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
      copyFileSync(join(src, entry.name), join(dest, entry.name));
      count++;
    }
  }
  // blocos: itens de bloco usam a textura do bloco, então copiamos também para
  // o resolver de ícones achar (items/ primeiro, blocks/ como fallback)
  const blockSrc = join(tmp, "assets", "minecraft", "textures", "block");
  const blockDest = join(OUT, "icons", "blocks");
  mkdirSync(blockDest, { recursive: true });
  let blockCount = 0;
  if (existsSync(blockSrc)) {
    for (const entry of readdirSync(blockSrc, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".png")) {
        copyFileSync(join(blockSrc, entry.name), join(blockDest, entry.name));
        blockCount++;
      } else if (entry.isDirectory()) {
        // texturas de bloco em subpastas (ex.: block/planks/oak.png)
        const nested = join(blockSrc, entry.name);
        for (const file of readdirSync(nested)) {
          if (file.endsWith(".png")) {
            copyFileSync(join(nested, file), join(blockDest, `${entry.name}_${file}`));
            blockCount++;
          }
        }
      }
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`▸ ícones de item: ${count} (+${blockCount} blocos)`);

  // ------------------------------------------------------------ panorama
  // As 6 faces do cubo da tela de título. Em 1024px ocupam ~24 MB de memória
  // de vídeo já decodificadas; em 512px a diferença é invisível na interface
  // (elas aparecem esticadas e com image-rendering: pixelated) e o consumo cai
  // para ~6 MB. Só reduz se o Pillow estiver disponível; senão segue em 1024.
  downscalePanorama();
}

function downscalePanorama() {
  const files = [];
  for (let i = 0; i < 6; i++) files.push(join(OUT, "gui", `panorama_${i}.png`));
  const existing = files.filter(existsSync);
  if (existing.length < 6) return;
  try {
    execFileSync("python3", [
      "-c",
      [
        "from PIL import Image",
        "import sys",
        "for f in sys.argv[1:]:",
        "    im = Image.open(f).convert('RGB').resize((512, 512), Image.NEAREST)",
        "    im.save(f, optimize=True)",
      ].join("\n"),
      ...existing,
    ]);
    console.log("▸ panorama reduzido para 512px (economia de memória de vídeo)");
  } catch {
    console.log("▸ panorama mantido em 1024px (Pillow não disponível)");
  }
}

// ---------------------------------------------------------------- execução
if (exists(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let ok = 0;
const missing = [];

// jars modernos (26.3)
console.log(`▸ fonte moderna:  ${JAR_263.jar}`);
for (const [dest, inner] of FROM_JARS) {
  const target = join(OUT, dest);
  if (JAR_263.files.has(inner)) {
    extractFromJar(JAR_263.jar, inner, target);
    ok++;
  } else missing.push([dest, inner]);
}
// jar antigo (server_selection, options_background)
console.log(`▸ fonte clássica: ${JAR_1165.jar}`);
for (const [dest, inner] of FROM_OLD_JAR) {
  const target = join(OUT, dest);
  if (JAR_1165.files.has(inner)) {
    extractFromJar(JAR_1165.jar, inner, target);
    ok++;
  } else missing.push([dest, inner]);
}
// índice (sons + panorama)
console.log(`▸ índice:         ${INDEX_FILE}`);
for (const [dest, key] of FROM_INDEX) {
  const target = join(OUT, dest);
  try {
    extractFromIndex(key, target);
    ok++;
  } catch (e) {
    missing.push([dest, key]);
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: { jar: JAR_263.jar, classicJar: JAR_1165.jar, index: basename(INDEX_FILE) },
  files: ok, missing,
}, null, 2));

console.log(`\n✅ ${ok} assets copiados para ${OUT}`);
if (missing.length) {
  console.log(`⚠️  ${missing.length} não encontrados (a UI usa fallback próprio para eles):`);
  for (const [d, s] of missing) console.log(`     ${d}  ←  ${s}`);
}
buildFontMap();
extractItemIcons();
buildIconIndex();
