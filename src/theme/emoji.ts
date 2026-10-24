/**
 * Catálogo de emojis/ícones unicode que a fonte do Minecraft sabe desenhar.
 *
 * A lista é montada a partir do próprio mapa de glifos copiado do jogo: só
 * entram caracteres que existem na fonte, então nada aparece como "caixinha
 * vazia" dentro do servidor.
 */
/**
 * Carrega o mapa de glifos por fetch (public/minecraft/fonts/font-map.json).
 * Só caracteres que existem na fonte do jogo entram no catálogo, então nada
 * aparece como "caixinha vazia" dentro do servidor.
 */
let MAP: Record<string, unknown> = {};
let loaded = false;

export async function ensureEmojiLoaded(): Promise<void> {
  if (loaded) return;
  try {
    MAP = await fetch("/minecraft/fonts/font-map.json").then((r) => r.json());
  } catch {
    MAP = {};
  }
  loaded = true;
}

export function emojiReady(): boolean {
  return loaded;
}

type Group = { name: string; chars: string[] };

/** Faixas de caracteres que valem a pena aparecer no catálogo. */
const RANGES: string[][] = [
  ["©ªº«»®°±²³µ¶·¹¼½¾¿×÷"], // símbolos matemáticos e tipográficos
  ["ĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſ"],
  ["ǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǢǣǤǥǦǧǨǩǪǫǬǭǮǯǰǱǲǳǴǵǶǷǸǹǺǻǼǽǾǿ"],
  ["ЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяёѓєѕіїјљњћќўџ"],
  ["ΆΈΉΊΌΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώ"],
  ["⌂⌘⌚⌛⏧⏩⏪⏫⏬⏭⏮⏯⏰⏱⏲⏳⏴⏵⏶⏷⏸⏹⏺⏻⏼⏽⏾⏿"],
  ["☀☁☂☃☄★☆☇☈☉☊☋☌☍☎☏☐☑☒☓☔☕☖☗☘☙☚☛☜☝☞☟☠☡☢☣☤☥☦☧☨☩☪☫☬☭☮☯☰☱☲☳☴☵☶☷☸☹☺☻☼☽☾☿♀♁♂♃♄♅♆♇♈♉♊♋♌♍♎♏♐♑♒♓♔♕♖♗♘♙♚♛♜♝♞♟♠♡♢♣♤♥♦♧♨♩♪♫♬♭♮♯♰♱♲♳♴♵♶♷♸♹♺♻♼♽♾♿⚀⚁⚂⚃⚄⚅⚆⚇⚈⚉⚊⚋⚌⚍⚎⚏⚐⚑⚒⚓⚔⚕⚖⚗⚘⚙⚚⚛⚜⚝⚞⚟⚠⚢⚣⚤⚥⚦⚧⚨⚩⚪⚫⚬⚭⚮⚯⚰⚱⚲⚳⚴⚵⚶⚷⚸⚹⚺⚻⚼⚽⚾⚿⛀⛁⛂⛃⛄⛅⛆⛇⛈⛉⛊⛋⛌⛍⛎⛏⛐⛑⛒⛓⛔⛕⛖⛗⛘⛙⛚⛛⛜⛝⛞⛟⛠⛡⛢⛣⛤⛥⛦⛧⛨⛩⛪⛫⛬⛭⛮⛯⛰⛱⛲⛳⛴⛵⛶⛷⛸⛹⛺⛻⛼⛽⛾⛿"],
  ["✀✁✂✃✄✅✆✇✈✉✊✋✌✍✎✏✐✑✒✓✔✕✖✗✘✙✚✛✜✝✞✟✠✡✢✣✤✥✦✧✨✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋❌❍❎❏❐❑❒❓❔❕❖❗❘❙❚❛❜❝❞❟❠❡❢❣❤❥❦❧❨❩❪❫❬❭❮❯❰❱❲❳❴❵❶❷❸❹❺❻❼❽❾❿"],
  ["➀➁➂➃➄➅➆➇➈➉➊➋➌➍➎➏➐➑➒➓➔➕➖➗➘➙➚➛➜➝➞➟➠➡➢➣➤➥➦➧➨➩➪➫➬➭➮➯➰➱➲➳➴➵➶➷➸➹➺➻➼➽➾➿"],
  ["⬀⬁⬂⬃⬄⬅⬆⬇⬈⬉⬊⬋⬌⬍⬎⬏⬐⬑⭐⬓⬔⬕⬖⬗⬘⬙⬚⬛⬜⬝⬞⬟⬠⬡⬢⬣⬤⬥⬦⬧⬨⬩⬪⬫⬬⬭⬮⬯⬰⬱⬲⬳⬴⬵⬶⬷⬸⬹⬺⬻⬼⬽⬾⬿⭀⭁⭂⭃⭄⭅⭆⭇⭈⭉⭊⭋⭌⭐⭑⭒⭓⭔⭕⭖⭗⭘⭙"],
  ["🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛🕜🕝🕞🕟🕠🕡🕢🕣🕤🕥🕦🕧"],
];

const GROUP_NAMES: string[] = [
  "Símbolos",
  "Acentuação",
  "Acentuação extra",
  "Cirílico",
  "Grego",
  "Relógios",
  "Símbolos e signos",
  "Marcadores",
  "Cercaduras",
  "Formas",
  "Horas",
];

/** Mantém apenas os caracteres que a fonte realmente possui. */
const groups: Group[] = RANGES.map((ranges, index) => ({
  name: GROUP_NAMES[index] ?? "Outros",
  chars: [...new Set([...ranges].filter((ch) => ch in MAP))],
})).filter((g) => g.chars.length > 0);

export const EMOJI_GROUPS: Group[] = groups;

/** Lista plana, para busca. */
export const ALL_EMOJI: string[] = groups.flatMap((g) => g.chars);

export function isEmojiSupported(ch: string): boolean {
  return ch in MAP;
}
