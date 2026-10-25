// Las Siete Partidas en la edición de la Real Academia de la Historia (Madrid, Imprenta Real, 1807),
// «cotejadas con varios códices antiguos». Ejemplar de la Biblioteca de la Universidad de Sevilla
// digitalizado en archive.org (dominio público), con OCR. Tres tomos:
//   T. 1: Partida I · T. 2: Partidas II y III · T. 3: Partidas IV a VII
//
// El OCR marca cada título como «TITULO XXIII» y cada ley como «LEY V.» (números romanos, a veces
// en minúsculas: «ley ii.»), y lleva en las cabeceras de página «PARTIDA IV.». El índice se
// reconstruye con esas marcas y con la secuencia (los títulos y las leyes avanzan de uno en uno).
//
// Ojo: la numeración es la de la edición de 1807, que no siempre coincide con la de Gregorio López
// (1555), la que tenía autoridad en el foro y la que probablemente sigue García Goyena.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SourceError } from "./http.js";
import { localizarTomo, paginarTomo } from "./archive.js";
import { DATA_DIR, limpiarPagina, sinAcentos, urlPagina, describirPaginas, etiquetasImpresas } from "./goyena.js";

export const FORMATO = 1;
export const EDICION =
    "Las Siete Partidas del Rey Don Alfonso el Sabio, cotejadas con varios códices antiguos por la Real Academia de la Historia, Madrid, Imprenta Real, 1807 (ejemplar de la Universidad de Sevilla en archive.org; dominio público)";

export const TOMOS = [
    { tomo: 1, ident: "BRes002050", partidas: [1] },
    { tomo: 2, ident: "BRes002051", partidas: [2, 3] },
    { tomo: 3, ident: "BRes002052", partidas: [4, 5, 6, 7] },
];

// ───────────────────────── Números romanos con OCR ─────────────────────────

const VALOR = { I: 1, V: 5, X: 10, L: 50, C: 100 };

/** «XXIII» → 23; tolera l/1/| por I. Devuelve null si no es un romano bien formado. */
export function romano(tok) {
    // La «l» minúscula y el 1 son casi siempre I mal leídas (la L de 50 va en mayúscula).
    const s = tok.replace(/[l1|!]/g, "I").toUpperCase().replace(/\.$/, "");
    if (!/^[IVXLC]{1,8}$/.test(s)) return null;
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const v = VALOR[s[i]];
        const sig = VALOR[s[i + 1]] ?? 0;
        n += v < sig ? -v : v;
    }
    // Comprobación: el número vuelto a escribir debe coincidir (descarta «IIIII», «VX»…).
    return aRomano(n) === s ? n : null;
}

export function aRomano(n) {
    const t = [[100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [v, r] of t) while (n >= v) (out += r), (n -= v);
    return out;
}

const ORDINAL = { PRIMERA: 1, SEGUNDA: 2, TERCERA: 3, QUARTA: 4, CUARTA: 4, QUINTA: 5, SEXTA: 6, SETENA: 7, SEPTIMA: 7 };
const mayusculas = (w) => (w.match(/[A-ZÁÉÍÓÚÑ]/g) ?? []).length / w.length >= 0.6;

/** Cabecera de página o portadilla: «3 PARTIDA IV.», «PARTIDA IV. 17», «PARTIDA QUARTA». */
export function leerPartida(linea) {
    const l = sinAcentos(linea.trim());
    let m = l.match(/^(?:\d{1,4}\s+)?(PARTIDA)\s+([IVXl1|]{1,4})\.?(?:\s+\d{1,4})?\s*$/i);
    if (m && mayusculas(m[1])) return romano(m[2]);
    m = l.match(/^(?:(PARTIDA)\s+([A-Z]{5,8})|([A-Z]{5,8})\s+(PARTIDA))\.?\s*$/);
    if (m) return ORDINAL[(m[2] ?? m[3]).toUpperCase()] ?? null;
    return null;
}

/** «TITULO XXIII» (con rúbrica opcional en la misma línea) → { n, resto }. */
export function leerTitulo(linea) {
    const m = linea.trim().match(/^([TtIl1][Il1íÍ]T[UÚ]L[O0])\s+([IVXLCl1|]{1,8})\b\.?\s*(.*)$/);
    if (!m || !mayusculas(m[1])) return null;
    const n = romano(m[2]);
    return n ? { n, resto: m[3].trim() } : null;
}

/** «LEY V.», «ley ii.» → { n, resto }. En minúsculas solo vale si la línea es solo la cabecera. */
export function leerLey(linea) {
    const m = linea.trim().match(/^(LEY|Ley|ley|LKY|I[,.]EY)\s+([IVXLCivxlc1|]{1,8})\b\.?\s*(.*)$/);
    if (!m) return null;
    const n = romano(m[2]);
    if (!n) return null;
    const resto = m[3].trim();
    if (!/^[LI]/.test(m[1]) && resto.length > 3) return null;
    return { n, resto };
}

// ───────────────────────── Índice ─────────────────────────

/**
 * Reconstruye títulos y leyes de un tomo. La Partida sale de las cabeceras de página; si no se
 * leen, se pasa a la siguiente cuando el título vuelve a I. Un título o una ley se aceptan si
 * siguen al anterior (con hasta tres cabeceras ilegibles en medio).
 */
export function indexarTomo(paginas, { partidas }) {
    const titulos = [];
    const leyes = [];
    let p = partidas[0];
    let t = 0;
    let l = 0;
    let partidaNueva = true;
    const rubricaTras = (lineas, k, resto) => {
        if (resto && resto.length > 3) return resto.slice(0, 160);
        for (let j = k + 1; j < Math.min(lineas.length, k + 4); j++) {
            const s = lineas[j].trim();
            if (s && !leerLey(s) && !leerTitulo(s)) return s.slice(0, 160);
        }
        return "";
    };
    paginas.forEach((texto, i) => {
        const lineas = texto.split("\n");
        let pos = 0;
        lineas.forEach((linea, k) => {
            const lp = leerPartida(linea);
            // Solo se avanza a la Partida siguiente: un número mal leído no hace saltar dos.
            if (lp && lp === partidas[partidas.indexOf(p) + 1]) {
                p = lp;
                t = 0;
                l = 0;
                partidaNueva = true;
            }
            const ti = leerTitulo(linea);
            if (ti) {
                const sigue = (n) => n > t && (t === 0 || n - t <= 4);
                let aceptar = sigue(ti.n);
                const sinLeyes = (x) => !leyes.some((y) => y.p === x.p && y.t === x.t);
                if (!aceptar && ti.n <= t && titulos.length && titulos.at(-1).p === p && sinLeyes(titulos.at(-1))) {
                    // La numeración vuelve atrás y los títulos anteriores no tienen ninguna ley: eran
                    // una tabla de títulos, no el texto. Se descartan.
                    while (titulos.length && titulos.at(-1).p === p && sinLeyes(titulos.at(-1))) titulos.pop();
                    t = titulos.length && titulos.at(-1).p === p ? titulos.at(-1).t : 0;
                    aceptar = sigue(ti.n);
                }
                if (!aceptar && ti.n === 1 && t > 1 && !partidaNueva) {
                    // Nueva Partida sin cabecera legible.
                    const sig = partidas[partidas.indexOf(p) + 1];
                    if (sig) {
                        p = sig;
                        aceptar = true;
                    }
                }
                if (aceptar) {
                    t = ti.n;
                    l = 0;
                    partidaNueva = false;
                    titulos.push({ p, t, pagina: i + 1, pos, rubrica: rubricaTras(lineas, k, ti.resto) });
                }
            } else {
                const le = t > 0 ? leerLey(linea) : null;
                if (le && le.n > l && le.n - l <= 4) {
                    l = le.n;
                    leyes.push({ p, t, l, pagina: i + 1, pos, rubrica: rubricaTras(lineas, k, le.resto) });
                }
            }
            pos += linea.length + 1;
        });
    });
    return { titulos, leyes };
}

/** Partición de un OCR sin \f por las cabeceras de página «PARTIDA IV.». */
export function paginasPorCabeceras(txt) {
    const pags = [];
    let cur = [];
    for (const l of txt.split("\n")) {
        if (leerPartida(l) && /\d/.test(l) && cur.some((x) => x.trim())) {
            pags.push(cur.join("\n"));
            cur = [];
        }
        cur.push(l);
    }
    if (cur.length) pags.push(cur.join("\n"));
    return pags;
}

// ───────────────────────── Descarga y carga ─────────────────────────

const fichero = (tomo) => join(DATA_DIR, `partidas-${tomo}.json`);

function leerFichero(f) {
    if (!existsSync(f)) return null;
    try {
        const d = JSON.parse(readFileSync(f, "utf-8"));
        return d.formato === FORMATO ? d : null;
    } catch {
        return null;
    }
}

async function descargarTomo(t, log) {
    const { ident, meta } = await localizarTomo({
        ident: t.ident,
        re: new RegExp(`T\\.\\s*${t.tomo}\\b`),
        q: `title:(siete partidas cotejadas "T. ${t.tomo}")`,
        etiqueta: `el tomo ${t.tomo} de las Partidas`,
        log,
    });
    const { paginas: brutas, paginacion, fuente } = await paginarTomo(ident, meta, log, { porCabeceras: paginasPorCabeceras });
    const paginas = brutas.map(limpiarPagina);
    const { titulos, leyes } = indexarTomo(paginas, t);
    log(`Partidas, tomo ${t.tomo} (${ident}): ${paginas.length} páginas (${fuente}), ${titulos.length} títulos y ${leyes.length} leyes reconocidos.`);
    return { formato: FORMATO, tomo: t.tomo, ident, titulo: meta.metadata?.title ?? "", partidas: t.partidas, paginacion, fuente, paginas };
}

export async function ingest({ log = console.error, force = false } = {}) {
    mkdirSync(DATA_DIR, { recursive: true });
    const resumen = [];
    for (const t of TOMOS) {
        if (!force && leerFichero(fichero(t.tomo))) {
            resumen.push(`Partidas, tomo ${t.tomo}: ya descargado.`);
            continue;
        }
        try {
            const d = await descargarTomo(t, log);
            writeFileSync(fichero(t.tomo), JSON.stringify(d));
            const { leyes } = indexarTomo(d.paginas, d);
            resumen.push(`Partidas, tomo ${t.tomo}: ${d.paginas.length} páginas, ${leyes.length} leyes.`);
        } catch (e) {
            const msg = `Partidas, tomo ${t.tomo}: ERROR ${e instanceof Error ? e.message : e}`;
            log(msg);
            resumen.push(msg);
        }
    }
    return resumen;
}

/** Número impreso en la cabecera «2 PARTIDA IV.» / «PARTIDA IV. 3» de una página. */
export function numeroImpreso(texto) {
    const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const l of lineas.slice(0, 3)) {
        if (!leerPartida(l)) continue;
        const m = l.match(/^(\d{1,4})\s/) ?? l.match(/\s(\d{1,4})$/);
        if (m) return Number(m[1]);
    }
    return null;
}

export function prepararTomo(d) {
    Object.assign(d, indexarTomo(d.paginas, d));
    d.etiquetas ??= etiquetasImpresas(d.paginas, numeroImpreso);
    return d;
}

let cargados;
let cargaEnCurso;

function leerTomos() {
    return TOMOS.map((t) => leerFichero(fichero(t.tomo))).filter(Boolean).map(prepararTomo);
}

export async function tomos() {
    if (cargados) return cargados;
    let t = leerTomos();
    if (t.length < TOMOS.length && process.env.CC_GOYENA_AUTOINGEST !== "0") {
        cargaEnCurso ??= ingest({ log: () => {} }).finally(() => (cargaEnCurso = undefined));
        await cargaEnCurso;
        t = leerTomos();
    }
    if (!t.length) {
        throw new SourceError(
            "El texto de las Partidas no está disponible: no se pudo descargar de archive.org. " +
                "Consulta los escaneos en https://archive.org/details/BRes002050 (T. 1), BRes002051 (T. 2) y BRes002052 (T. 3).",
        );
    }
    cargados = t;
    return t;
}

export function _setTomos(t) {
    cargados = t;
}

// ───────────────────────── Consulta ─────────────────────────

/** Texto desde la cabecera de una ley hasta la cabecera siguiente (ley o título). */
function tramo(tomo, desde, hasta, maxChars) {
    const trozos = [];
    const finPag = hasta ? hasta.pagina : Math.min(desde.pagina + 2, tomo.paginas.length);
    for (let p = desde.pagina; p <= finPag; p++) {
        let t = tomo.paginas[p - 1];
        if (hasta && p === hasta.pagina) t = t.slice(0, hasta.pos);
        if (p === desde.pagina) t = t.slice(desde.pos);
        trozos.push(t);
        if (trozos.join("\n").length > maxChars) break;
    }
    return { texto: trozos.join("\n").slice(0, maxChars), paginas: { desde: desde.pagina, hasta: finPag } };
}

const clave = (x) => x.pagina * 1e8 + x.pos;

/**
 * Ley de las Partidas. Si su cabecera no se ha reconocido, devuelve la ley anterior del mismo
 * título, cuyo tramo la contiene (exacto: false).
 */
export async function ley(p, t, l, maxChars = 8000) {
    if (!(p >= 1 && p <= 7)) throw new SourceError(`Las Partidas son siete; «${p}» no es una Partida.`);
    const ts = await tomos();
    const tomo = ts.find((x) => x.partidas.includes(p));
    if (!tomo) throw new SourceError(`El tomo de la Partida ${p} no está descargado.`);
    const titulo = tomo.titulos.find((x) => x.p === p && x.t === t);
    const delTitulo = tomo.leyes.filter((x) => x.p === p && x.t === t);
    let entrada = delTitulo.find((x) => x.l === l);
    let exacto = true;
    if (!entrada) {
        exacto = false;
        entrada = delTitulo.filter((x) => x.l < l).pop();
        if (!entrada) {
            if (!titulo) throw new SourceError(`No se ha localizado el título ${t} de la Partida ${p} en el OCR.`);
            entrada = { p, t, l: 0, pagina: titulo.pagina, pos: titulo.pos, rubrica: titulo.rubrica };
        }
    }
    const marcas = [...tomo.leyes, ...tomo.titulos].filter((x) => clave(x) > clave(entrada)).sort((a, b) => clave(a) - clave(b));
    const { texto, paginas } = tramo(tomo, entrada, marcas[0], maxChars);
    return {
        tomo,
        titulo,
        entrada,
        exacto,
        texto,
        paginas,
        url: urlPagina(tomo, paginas.desde),
        paginaTexto: describirPaginas(tomo, paginas.desde, paginas.hasta),
        leyesDelTitulo: delTitulo.length ? Math.max(...delTitulo.map((x) => x.l)) : 0,
    };
}

const norm = (s) => sinAcentos(s).toLowerCase().replace(/(\p{Ll})[-¬] (\p{Ll})/gu, "$1$2");

/** Búsqueda por palabras; cada resultado dice en qué ley cae. */
export async function buscar(consulta, { partida, limite = 10 } = {}) {
    const ts = await tomos();
    const terminos = norm(consulta).split(/\s+/).filter((w) => w.length > 1);
    if (!terminos.length) throw new SourceError("Escribe al menos una palabra.");
    const res = [];
    for (const tomo of ts) {
        tomo.paginas.forEach((pag, i) => {
            const np = norm(pag);
            if (!terminos.every((w) => np.includes(w))) return;
            const at = np.indexOf(terminos[0]);
            const k = (i + 1) * 1e8 + at;
            // Última marca (título o ley) antes del resultado.
            let donde;
            for (const x of tomo.leyes) if (clave(x) <= k && (!donde || clave(x) > clave(donde))) donde = x;
            for (const x of tomo.titulos) if (clave(x) <= k && (!donde || clave(x) > clave(donde))) donde = { p: x.p, t: x.t, pagina: x.pagina, pos: x.pos };
            if (partida && donde?.p !== partida) return;
            const ini = Math.max(0, at - 160);
            res.push({
                tomo: tomo.tomo,
                donde,
                url: urlPagina(tomo, i + 1),
                paginaTexto: describirPaginas(tomo, i + 1, i + 1),
                fragmento: pag.slice(ini, ini + 360).replace(/\s+/g, " "),
            });
        });
    }
    return { total: res.length, resultados: res.slice(0, limite) };
}
