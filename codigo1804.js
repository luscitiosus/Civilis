// Code civil des Français de 1804 (Code Napoléon) en su redacción original, de la transcripción de
// Wikisource («Code civil des Français 1804», dominio público; texto CC BY-SA). Es el modelo más
// citado por García Goyena en el Proyecto de 1851 y, a través de él, por el Código de 1889.
//
// Se descarga la página «Texte entier» con la API de MediaWiki; si no da el Código completo, se
// recorren las subpáginas «Livre I, Titre I»… El índice de artículos se reconstruye con las
// cabeceras «Art. 552.» / «552.» / «Article premier.» exigiendo que los números avancen (así no se
// confunden con enumeraciones internas). Ojo: el parser se ha probado con textos de ejemplo, no
// todavía contra la página real de Wikisource; la ingesta informa de cuántos artículos reconoce.
//
// Además lee en García Goyena las concordancias con el Code («El artículo ha sido tomado de los
// 319 y 320 Franceses»): es OCR, así que un número mal leído (520 por 320) da un artículo
// equivocado y hay que comprobarlo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request, SourceError } from "./http.js";
import { htmlToText } from "./text.js";
import { DATA_DIR, sinAcentos } from "./goyena.js";

export const FORMATO = 1;
export const TOTAL = 2281;
export const OBRA = "Code civil des Français, édition originale et seule officielle, Paris, Imprimerie de la République, an XII (1804)";
export const FUENTE = "transcripción de Wikisource en francés (Code civil des Français 1804; dominio público, texto de Wikisource CC BY-SA 4.0)";
const WS = "https://fr.wikisource.org";
export const PAGINA = "Code civil des Français 1804";
const urlWs = (titulo) => `${WS}/wiki/${encodeURIComponent(titulo.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%2C/g, ",")}`;
export const URL_OBRA = urlWs(PAGINA);
export const URL_GALLICA = "https://gallica.bnf.fr/ark:/12148/cb339642859";

// ───────────────────────── Análisis del texto ─────────────────────────

const ORD_FR = { premier: 1, "1er": 1, "1.er": 1, unique: 1 };

/**
 * ¿Empieza aquí un artículo? «Art. 552. La propriété…», «Article 552 — …», «552. La propriété…»,
 * «Article premier. Les lois…», «Art. 1er. …». Devuelve { n, resto } o null.
 */
export function leerArticulo(linea) {
    const l = linea.trim().replace(/ /g, " ");
    let m = l.match(/^(?:Art(?:icle)?\.?\s*)(premier|unique|1\.?er|\d{1,4})\s*(?:er)?\s*[.:—–-]?\s*(.*)$/i);
    if (m) {
        const n = ORD_FR[m[1].toLowerCase()] ?? Number(m[1]);
        if (Number.isFinite(n) && n >= 1) return { n, resto: m[2].trim() };
    }
    // Número solo, con punto y texto en mayúscula detrás: «552. La propriété…».
    m = l.match(/^(\d{1,4})\s*\.\s+(\p{Lu}.*)$/u);
    if (m) return { n: Number(m[1]), resto: m[2].trim(), desnudo: true };
    return null;
}

const DIVISIONES = [
    ["livre", /^LIVRE\b/i],
    ["titre", /^TITRE\b/i],
    ["chapitre", /^CHAPITRE\b/i],
    ["section", /^SECTION\b/i],
    ["paragraphe", /^§\s*\d/],
];
const NIVEL = Object.fromEntries(DIVISIONES.map(([k], i) => [k, i]));

/** «LIVRE II.», «TITRE PREMIER. De la jouissance…», «CHAPITRE III.», «SECTION 1.re», «§ 2.» */
export function leerDivision(linea) {
    const l = linea.trim();
    if (l.length > 220) return null;
    for (const [k, re] of DIVISIONES) if (re.test(l)) return { nivel: k, texto: l.replace(/\s+/g, " ") };
    return null;
}

/**
 * Parte el texto en artículos. Una cabecera solo se acepta si su número sigue al anterior (salto
 * de 1 a 4, para tolerar alguno ilegible); con «Art.» explícito, también con saltos de hasta 12 o si
 * la confirma una de las tres siguientes.
 * Las líneas de división (Livre, Titre…) se guardan como contexto y no entran en el artículo.
 */
export function analizar(texto) {
    const lineas = texto.split("\n");
    const cands = [];
    lineas.forEach((l, i) => {
        const a = leerArticulo(l);
        if (a) cands.push({ ...a, i });
    });
    const aceptadas = [];
    let ultimo = 0;
    cands.forEach((c, k) => {
        if (c.n <= ultimo) return;
        const salto = c.n - ultimo;
        const confirmada = cands.slice(k + 1, k + 4).some((x) => x.n > c.n && x.n - c.n <= 4);
        if (salto <= 4 || (!c.desnudo && (salto <= 12 || (confirmada && (salto <= 40 || !aceptadas.length))))) {
            aceptadas.push(c);
            ultimo = c.n;
        }
    });
    const marcas = new Set(aceptadas.map((a) => a.i));
    const ctx = {};
    const articulos = [];
    let actual = null;
    lineas.forEach((l, i) => {
        if (marcas.has(i)) {
            const a = aceptadas.find((x) => x.i === i);
            actual = { n: a.n, lineas: a.resto ? [a.resto] : [], contexto: { ...ctx } };
            articulos.push(actual);
            return;
        }
        const d = leerDivision(l);
        if (d) {
            ctx[d.nivel] = d.texto;
            for (const [k] of DIVISIONES) if (NIVEL[k] > NIVEL[d.nivel]) delete ctx[k];
            // La rúbrica va a veces en la línea siguiente: se añade si es corta y no es un artículo.
            const sig = lineas.slice(i + 1, i + 4).map((x) => x.trim()).find(Boolean);
            const soloNumero = /^(?:LIVRE|TITRE|CHAPITRE|SECTION|§)\s*(?:[IVXLC]+|\d+|PREMIER|PRÉLIMINAIRE|UNIQUE)?\s*(?:\.?\s*(?:er|re|ère))?\s*\.?$/i.test(d.texto);
            if (soloNumero && sig && sig.length < 160 && !leerArticulo(sig) && !leerDivision(sig)) ctx[d.nivel] += ` ${sig}`;
            actual = null;
            return;
        }
        if (actual && l.trim()) actual.lineas.push(l.trim());
    });
    return articulos.map((a) => ({ n: a.n, texto: a.lineas.join("\n").trim(), contexto: a.contexto }));
}

// ───────────────────────── Descarga ─────────────────────────

async function api(params) {
    const q = new URLSearchParams({ format: "json", formatversion: "2", redirects: "1", ...params });
    const res = await request(`${WS}/w/api.php?${q}`, { headers: { Accept: "application/json" }, noCache: true });
    const json = JSON.parse(res.text());
    if (json.error) throw new SourceError(`Wikisource: ${json.error.info ?? json.error.code}`, res.url);
    return json;
}

async function textoDePagina(titulo) {
    const json = await api({ action: "parse", page: titulo, prop: "text", disablelimitreport: "1", disableeditsection: "1" });
    // Fuera notas, cabeceras de navegación y números de página del escaneo.
    const html = String(json.parse?.text ?? "").replace(/<(sup|span)[^>]*class="[^"]*(reference|pagenum|ws-pagenum)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, "");
    return htmlToText(html.replace(/<div[^>]*(?:id|class)="[^"]*(?:headertemplate|ws-noexport|navigation)[^"]*"[\s\S]*?<\/div>/gi, ""));
}

/** Subpáginas del Código («…/Livre I, Titre II»), en el orden en que las enlaza la página principal. */
async function subpaginas() {
    const json = await api({ action: "parse", page: PAGINA, prop: "links" });
    const vistos = new Set();
    return (json.parse?.links ?? [])
        .map((l) => l.title)
        .filter((t) => t.startsWith(`${PAGINA}/`) && !/Texte entier/i.test(t) && !vistos.has(t) && vistos.add(t));
}

const fichero = () => join(DATA_DIR, "code1804.json");

export async function descargar(log = () => {}) {
    let articulos = [];
    let origen = `${PAGINA}/Texte entier`;
    try {
        articulos = analizar(await textoDePagina(origen));
    } catch (e) {
        log(`Code 1804: «Texte entier» no disponible (${e instanceof Error ? e.message : e}); se prueban las subpáginas.`);
    }
    if (articulos.length < TOTAL * 0.9) {
        const subs = await subpaginas();
        const trozos = [];
        for (const t of subs) trozos.push(await textoDePagina(t));
        const otros = analizar(trozos.join("\n"));
        if (otros.length > articulos.length) {
            articulos = otros;
            origen = `${PAGINA} (${subs.length} subpáginas)`;
        }
    }
    if (!articulos.length) throw new SourceError("No se ha reconocido ningún artículo del Code de 1804 en Wikisource.");
    return { formato: FORMATO, origen, url: urlWs(origen.includes("subpáginas") ? PAGINA : origen), descargado: new Date().toISOString(), articulos };
}

function leerFichero() {
    const f = fichero();
    if (!existsSync(f)) return null;
    try {
        const d = JSON.parse(readFileSync(f, "utf-8"));
        return d.formato === FORMATO ? d : null;
    } catch {
        return null;
    }
}

export async function ingest({ log = console.error, force = false } = {}) {
    mkdirSync(DATA_DIR, { recursive: true });
    if (!force && leerFichero()) return ["Code 1804: ya descargado."];
    try {
        const d = await descargar(log);
        writeFileSync(fichero(), JSON.stringify(d));
        const faltan = TOTAL - new Set(d.articulos.map((a) => a.n)).size;
        return [`Code 1804: ${d.articulos.length} artículos reconocidos de ${TOTAL} (${d.origen})${faltan > 0 ? `; faltan ${faltan}` : ""}.`];
    } catch (e) {
        const msg = `Code 1804: ERROR ${e instanceof Error ? e.message : e}`;
        log(msg);
        return [msg];
    }
}

let cargado;
let cargaEnCurso;

export async function datos() {
    if (cargado) return cargado;
    let d = leerFichero();
    if (!d && process.env.CC_GOYENA_AUTOINGEST !== "0") {
        cargaEnCurso ??= ingest({ log: () => {} }).finally(() => (cargaEnCurso = undefined));
        await cargaEnCurso;
        d = leerFichero();
    }
    if (!d) throw new SourceError(`El texto del Code de 1804 no está disponible: no se pudo descargar de Wikisource. Consúltalo en ${URL_OBRA}.`);
    cargado = d;
    return d;
}

export function _setDatos(d) {
    cargado = d;
}

// ───────────────────────── Consulta ─────────────────────────

export async function articulo(n) {
    if (!(n >= 1 && n <= TOTAL)) throw new SourceError(`El Code de 1804 tiene ${TOTAL} artículos; ${n} está fuera de rango.`);
    const d = await datos();
    const a = d.articulos.find((x) => x.n === n);
    if (!a) {
        const antes = d.articulos.filter((x) => x.n < n).pop();
        throw new SourceError(
            `No se ha reconocido el art. ${n} del Code en la transcripción${antes ? ` (puede estar dentro del texto del art. ${antes.n}: code_articulo(${antes.n}))` : ""}. Consúltalo en ${d.url}.`,
        );
    }
    return { ...a, url: d.url, origen: d.origen };
}

const norm = (s) => sinAcentos(s).toLowerCase();

export async function buscar(consulta, limite = 10) {
    const d = await datos();
    const ws = norm(consulta).split(/\s+/).filter((w) => w.length > 1);
    if (!ws.length) throw new SourceError("Escribe al menos una palabra.");
    const res = d.articulos.filter((a) => {
        const t = norm(a.texto);
        return ws.every((w) => t.includes(w));
    });
    return { total: res.length, resultados: res.slice(0, limite) };
}

/** «LIVRE II. … › TITRE II. … › CHAPITRE I.» */
export function describirContexto(c) {
    return DIVISIONES.map(([k]) => c?.[k]).filter(Boolean).join(" › ");
}

// ───────────────────────── Concordancias de García Goyena con el Code ─────────────────────────

function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

const esFrances = (w) => w.length >= 6 && w.length <= 10 && (levenshtein(w, "frances") <= 1 || levenshtein(w, "franceses") <= 1 || levenshtein(w, "francesa") <= 1);

/**
 * Artículos del Code que cita un texto de García Goyena: «los 319 y 320 Franceses», «el 6 Francés»,
 * «artículos 552 al 555 del Código francés». La lista de números tiene que ir pegada a «Francés»
 * (como mucho con «del Código (civil)» en medio): así no se toman los números de otros códigos
 * («212 y 213 de la Luisiana») ni los del propio Proyecto.
 */
export function citasFrancesas(texto) {
    const plano = norm(texto).replace(/\s+/g, " ");
    const out = [];
    const vistos = new Set();
    for (const m of plano.matchAll(/[a-z]{6,10}/g)) {
        if (!esFrances(m[0])) continue;
        const antes = plano.slice(Math.max(0, m.index - 80), m.index);
        const lm = antes.match(/((?:\d{1,4}\s*(?:,|\by\b|\be\b|\bal\b|\ba\b)\s*)*\d{1,4})\s*[,.]?\s*(?:del?\s+)?(?:(?:el|los)\s+)?(?:codigo\s+(?:civil\s+)?)?$/);
        if (!lm) continue;
        const lista = lm[1];
        const nums = [];
        const partes = lista.split(/\s*(?:,|\by\b|\be\b)\s*/);
        for (const p of partes) {
            const r = p.match(/^(\d{1,4})\s*(?:\bal\b|\ba\b)\s*(\d{1,4})$/);
            if (r) {
                const [a, b] = [Number(r[1]), Number(r[2])];
                if (b > a && b - a <= 12) for (let k = a; k <= b; k++) nums.push(k);
                else nums.push(a, b);
            } else if (/^\d{1,4}$/.test(p)) nums.push(Number(p));
        }
        const original = texto.replace(/\s+/g, " ").slice(Math.max(0, m.index - lm[0].length), m.index + m[0].length).trim();
        for (const n of nums) {
            if (n < 1 || n > TOTAL || vistos.has(n)) continue;
            vistos.add(n);
            out.push({ n, original });
        }
    }
    return out;
}

/** Artículos del Code que cita el texto y comentario de un artículo del Proyecto en García Goyena. */
export function citasFrancesasDe(goyenaTomo, idx, textoArticulo) {
    return citasFrancesas(textoArticulo(goyenaTomo, idx, 60000).texto);
}

let indiceGoyena;

/**
 * Índice inverso de todo García Goyena: n del Code → [{ proyecto, tomo, inferido, original }].
 * Recibe el módulo goyena para no crear una dependencia circular al cargar.
 */
export async function goyenaQueCita(goyenaMod, n) {
    if (!indiceGoyena) {
        const mapa = new Map();
        for (const t of await goyenaMod.tomos()) {
            t.articulos.forEach((a, i) => {
                for (const c of citasFrancesasDe(t, i, goyenaMod.textoArticulo)) {
                    if (!mapa.has(c.n)) mapa.set(c.n, []);
                    mapa.get(c.n).push({ proyecto: a.n, tomo: t.tomo, inferido: a.inferido === true, original: c.original });
                }
            });
        }
        indiceGoyena = mapa;
    }
    return indiceGoyena.get(n) ?? [];
}

export function _resetIndiceGoyena() {
    indiceGoyena = undefined;
}
