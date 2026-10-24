/**
 * Caminhos dos assets do Minecraft copiados pelo tools/copy-assets.mjs.
 *
 * Os arquivos vivem em src/assets/minecraft. O Vite os serve como URL; quando o
 * app é empacotado eles entram no bundle, então o usuário final não precisa ter
 * o jogo instalado.
 */

/**
 * Caminho absoluto do asset.
 *
 * Os arquivos ficam em `public/minecraft/` e o Vite a copia para a raiz do
 * `dist/` sem renomear. Usar caminho absoluto (e não `new URL(...,
 * import.meta.url)`) é o que garante que funcione no app empacotado: com
 * `import.meta.url` dinâmico o Vite não consegue analisar e os arquivos
 * simplesmente não são incluídos no build.
 */
const base = (rel: string) => `/minecraft/${rel}`;

/** Texturas de interface. */
export const TEX = {
  button: base("gui/widgets/button.png"),
  buttonHover: base("gui/widgets/button_highlighted.png"),
  buttonDisabled: base("gui/widgets/button_disabled.png"),
  scroller: base("gui/widgets/scroller.png"),
  scrollerTrack: base("gui/widgets/scroller_background.png"),
  tab: base("gui/widgets/tab.png"),
  tabSelected: base("gui/widgets/tab_selected.png"),
  tabSelectedHover: base("gui/widgets/tab_selected_highlighted.png"),
  menuListBg: base("gui/menu_list_background.png"),
  inworldMenuListBg: base("gui/inworld_menu_list_background.png"),
  optionsBg: base("gui/options_background.png"),
  serverSelection: base("gui/server_selection.png"),
  inventory: base("gui/container/inventory.png"),
  slot: base("gui/container/slot.png"),
  headerSeparator: base("gui/header_separator.png"),
  footerSeparator: base("gui/footer_separator.png"),
  panoramaOverlay: base("gui/panorama_overlay.png"),
} as const;

/** As 6 faces do panorama da tela de título. */
export const PANORAMA = [
  base("gui/panorama_0.png"),
  base("gui/panorama_1.png"),
  base("gui/panorama_2.png"),
  base("gui/panorama_3.png"),
  base("gui/panorama_4.png"),
  base("gui/panorama_5.png"),
] as const;

/** Ícones de blocos (usados como ícone padrão de servidor). */
export const ICONS = {
  dirt: base("icons/dirt.png"),
  grass: base("icons/grass_block_top.png"),
  stone: base("icons/stone.png"),
  cobblestone: base("icons/cobblestone.png"),
  planks: base("icons/oak_planks.png"),
  diamond: base("icons/diamond.png"),
} as const;

/** Fonts bitmap. */
export const FONTS = {
  ascii: base("fonts/ascii.png"),
  accented: base("fonts/accented.png"),
  nonlatin: base("fonts/nonlatin_european.png"),
} as const;

/** Sons do jogo. */
export const SOUNDS = {
  click: base("sounds/click.ogg"),
  clickStereo: base("sounds/click_stereo.ogg"),
  pop: base("sounds/pop.ogg"),
  levelup: base("sounds/levelup.ogg"),
  orb: base("sounds/orb.ogg"),
  fizz: base("sounds/fizz.ogg"),
  glass: base("sounds/glass1.ogg"),
  explode: base("sounds/explode1.ogg"),
  bass: base("sounds/bass.ogg"),
  hit: base("sounds/successful_hit.ogg"),
  anvil: base("sounds/anvil_land.ogg"),
  chestOpen: base("sounds/chestopen.ogg"),
  chestClose: base("sounds/chestclosed.ogg"),
  bowHit: base("sounds/bowhit1.ogg"),
  burp: base("sounds/burp.ogg"),
  woodClick: base("sounds/wood_click.ogg"),
} as const;

export type SoundName = keyof typeof SOUNDS;
