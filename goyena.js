// García Goyena, Concordancias, motivos y comentarios del Código civil español (Madrid, 1852),
// comentario al Proyecto de Código civil de 1851. Ejemplar de la Biblioteca de la Universidad de
// Sevilla digitalizado en archive.org (dominio público), con texto OCR por páginas.
//
// El OCR imprime cada artículo del Proyecto como «ARTICULO 569.», a menudo con errores
// («ARTICLLO 5bl.», «AUTIGüLO 554.:»). El índice de artículos se reconstruye con tolerancia
// y con una comprobación de orden: los números deben crecer dentro de cada tomo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request, SourceError } from "./http.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.CC_DATA_DIR ?? join(HERE, "data");

/** Tomos y artículos del Proyecto que comenta cada uno (según la descripción de archive.org). */
export const TOMOS = [
    { tomo: 1, ident: "BRes0414951", desde: 1, hasta: 547 },
    { tomo: 2, ident: "BRes0414952", desde: 548, hasta: 972 },
    { tomo: 3, ident: "BRes0414953", desde: 973, hasta: 1563 },
    { tomo: 4, ident: "BRes0414954", desde: 1564, hasta: 1992 },
];

export const urlPagina = (ident, p) => `https://archive.org/details/${ident}/page/n${p - 1}/mode/1up`;

// ───────────────────────── Normalización y OCR ─────────────────────────

export function sinAcentos(s) {
    return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function levenshtein(a, b) {
    const m = b.length;
    let prev = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= m; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[m];
}

/** Cifras que el OCR confunde con letras. */
function numeroOcr(tok) {
    const s = tok.replace(/[lIi|]/g, "1").replace(/[oO]/g, "0").replace(/[S]/g, "5").replace(/[B]/g, "8");
    return /^\d{1,4}$/.test(s) ? Number(s) : null;
}

/**
 * ¿Es esta línea una cabecera «ARTICULO n.»? Devuelve n o null.
 * La palabra debe parecerse a ARTICULO (distancia ≤ 2) y estar en mayúsculas en su mayor parte.
 */
export function cabeceraArticulo(linea) {
    const m = linea.trim().match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]{6,10})\.?\s+([0-9lIOoSB|]{1,4})\s*[.:,;·]/);
    if (!m) return null;
    const palabra = sinAcentos(m[1]).toUpperCase().replace(/0/g, "O").replace(/1/g, "I");
    const mayus = (m[1].match(/[A-ZÁÉÍÓÚÜÑ0-9]/g) ?? []).length / m[1].length;
    if (mayus < 0.6) return null;
    if (levenshtein(palabra, "ARTICULO") > 2) return null;
    return numeroOcr(m[2]);
}

const GUION_FIN = /(\w)[-¬]\s*\n\s*(\w)/g;

export function limpiarPagina(t) {
    return t.replace(GUION_FIN, "$1$2").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reconstruye el índice de artículos de un tomo. Acepta una cabecera si su número está en el
 * rango del tomo y avanza poco respecto a la anterior (descarta números mal leídos).
 */
export function indexarTomo(paginas, { desde, hasta }) {
    const cands = [];
    paginas.forEach((texto, i) => {
        let pos = 0;
        for (const l of texto.split("\n")) {
            const n = cabeceraArticulo(l);
            if (n != null && n >= desde && n <= hasta) cands.push({ n, pagina: i + 1, pos });
            pos += l.length + 1;
        }
    });
    // Un número se acepta si sigue de cerca al anterior aceptado, o si el siguiente candidato
    // lo confirma (salto tras varias cabeceras ilegibles). Así se descartan lecturas erróneas.
    const arts = [];
    let ultimo = null;
    cands.forEach((c, k) => {
        if (ultimo != null && c.n <= ultimo) return;
        const cerca = ultimo != null && c.n - ultimo <= 12;
        const sig = cands[k + 1];
        const confirmado = sig && sig.n > c.n && sig.n - c.n <= 4;
        if (cerca || confirmado || (ultimo == null && !sig)) {
            arts.push(c);
            ultimo = c.n;
        }
    });
    return arts;
}

// ───────────────────────── Descarga (ingest) ─────────────────────────

async function metadatosArchive(ident) {
    const res = await request(`https://archive.org/metadata/${ident}`, { headers: { Accept: "application/json" } });
    return JSON.parse(res.text());
}

/** Si un identificador no corresponde al tomo esperado, lo busca en archive.org. */
async function buscarTomo(tomo) {
    const q = `title:(concordancias motivos comentarios "T. ${tomo}") AND creator:(goyena)`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&rows=20&output=json`;
    const json = JSON.parse((await request(url)).text());
    const docs = json?.response?.docs ?? [];
    const re = new RegExp(`T\\.\\s*${tomo}\\b`);
    return docs.find((d) => re.test(d.title ?? ""))?.identifier;
}

async function descargarTomo(t, log) {
    let ident = t.ident;
    let meta;
    try {
        meta = await metadatosArchive(ident);
    } catch {
        meta = undefined;
    }
    const titulo = meta?.metadata?.title ?? "";
    if (!meta?.files || !new RegExp(`T\\.\\s*${t.tomo}\\b`).test(titulo)) {
        log(`Tomo ${t.tomo}: ${ident} no coincide (${titulo || "sin metadatos"}); buscando en archive.org…`);
        const otro = await buscarTomo(t.tomo).catch(() => undefined);
        if (!otro) throw new SourceError(`No se ha encontrado el tomo ${t.tomo} de García Goyena en archive.org.`);
        ident = otro;
        meta = await metadatosArchive(ident);
    }
    const djvu = (meta.files ?? []).find((f) => f.name.endsWith("_djvu.txt"));
    if (!djvu) throw new SourceError(`${ident}: sin texto OCR (_djvu.txt).`);
    const raw = (await request(`https://archive.org/download/${ident}/${encodeURIComponent(djvu.name)}`, { noCache: true })).text();
    const paginas = raw.split("\f").map(limpiarPagina);
    const articulos = indexarTomo(paginas, t);
    log(`Tomo ${t.tomo} (${ident}): ${paginas.length} páginas, ${articulos.length} artículos del Proyecto reconocidos de ${t.hasta - t.desde + 1}.`);
    return { tomo: t.tomo, ident, titulo: meta.metadata?.title ?? "", desde: t.desde, hasta: t.hasta, paginas, articulos };
}

export async function ingest({ log = console.error, force = false } = {}) {
    mkdirSync(DATA_DIR, { recursive: true });
    const resumen = [];
    for (const t of TOMOS) {
        const dest = join(DATA_DIR, `goyena-${t.tomo}.json`);
        if (existsSync(dest) && !force) {
            resumen.push(`Tomo ${t.tomo}: ya descargado.`);
            continue;
        }
        try {
            const datos = await descargarTomo(t, log);
            writeFileSync(dest, JSON.stringify(datos));
            resumen.push(`Tomo ${t.tomo}: ${datos.articulos.length} artículos.`);
        } catch (e) {
            const msg = `Tomo ${t.tomo}: ERROR ${e instanceof Error ? e.message : e}`;
            log(msg);
            resumen.push(msg);
        }
    }
    return resumen;
}

// ───────────────────────── Carga y consulta ─────────────────────────

let tomosCargados;
let cargaEnCurso;

function leerTomos() {
    const out = [];
    for (const t of TOMOS) {
        const f = join(DATA_DIR, `goyena-${t.tomo}.json`);
        if (existsSync(f)) out.push(JSON.parse(readFileSync(f, "utf-8")));
    }
    return out;
}

/** Carga los tomos; si faltan (p. ej. en uso local sin `npm run ingest`), los descarga una vez. */
export async function tomos() {
    if (tomosCargados) return tomosCargados;
    let t = leerTomos();
    if (t.length < TOMOS.length && process.env.CC_GOYENA_AUTOINGEST !== "0") {
        cargaEnCurso ??= ingest({ log: () => {} }).finally(() => (cargaEnCurso = undefined));
        await cargaEnCurso;
        t = leerTomos();
    }
    if (!t.length) {
        throw new SourceError(
            "El texto de García Goyena no está disponible: no se pudo descargar de archive.org. " +
                "Consulta los escaneos en https://archive.org/details/BRes0414951 (T. 1) y siguientes.",
        );
    }
    tomosCargados = t;
    return t;
}

export function _setTomos(t) {
    tomosCargados = t;
}

/** Texto de un artículo del Proyecto de 1851: desde su cabecera hasta la siguiente. */
export function textoArticulo(tomo, idx, maxChars = 12000) {
    const a = tomo.articulos[idx];
    const sig = tomo.articulos[idx + 1];
    const trozos = [];
    for (let p = a.pagina; p <= (sig ? sig.pagina : a.pagina + 3) && p <= tomo.paginas.length; p++) {
        let t = tomo.paginas[p - 1];
        if (sig && p === sig.pagina) t = t.slice(0, sig.pos);
        if (p === a.pagina) t = t.slice(a.pos);
        trozos.push(t);
        if (trozos.join("\n").length > maxChars) break;
    }
    const paginas = { desde: a.pagina, hasta: sig ? sig.pagina : Math.min(a.pagina + 3, tomo.paginas.length) };
    return { texto: trozos.join("\n").slice(0, maxChars), paginas };
}

export async function articuloProyecto(n) {
    const ts = await tomos();
    const tomo = ts.find((t) => n >= t.desde && n <= t.hasta);
    if (!tomo) {
        const faltan = TOMOS.filter((t) => n >= t.desde && n <= t.hasta).map((t) => t.tomo);
        if (faltan.length) throw new SourceError(`El tomo ${faltan[0]} de García Goyena no está descargado.`);
        throw new SourceError(`El Proyecto de 1851 tiene 1992 artículos; ${n} está fuera de rango.`);
    }
    const idx = tomo.articulos.findIndex((a) => a.n === n);
    if (idx >= 0) return { tomo, idx, exacto: true };
    // Cabecera ilegible en el OCR: se devuelve el artículo reconocido anterior, cuyo tramo la contiene.
    let prev = -1;
    tomo.articulos.forEach((a, i) => {
        if (a.n < n) prev = i;
    });
    if (prev < 0) throw new SourceError(`No se ha localizado el artículo ${n} en el OCR del tomo ${tomo.tomo}.`);
    return { tomo, idx: prev, exacto: false };
}

// ───────────────────────── Búsqueda por palabras ─────────────────────────

const norm = (s) => sinAcentos(s).toLowerCase();

export async function buscar(consulta, { tomo, limite = 10 } = {}) {
    const ts = (await tomos()).filter((t) => !tomo || t.tomo === tomo);
    const terminos = norm(consulta).split(/\s+/).filter((w) => w.length > 1);
    if (!terminos.length) throw new SourceError("Escribe al menos una palabra.");
    const res = [];
    for (const t of ts) {
        t.paginas.forEach((pag, i) => {
            const np = norm(pag);
            if (!terminos.every((w) => np.includes(w))) return;
            const at = np.indexOf(terminos[0]);
            const ini = Math.max(0, at - 160);
            // artículo del Proyecto que se comenta en esa página
            let art;
            for (const a of t.articulos) if (a.pagina <= i + 1) art = a.n;
            res.push({
                tomo: t.tomo,
                ident: t.ident,
                pagina: i + 1,
                articulo: art,
                fragmento: pag.slice(ini, ini + 360).replace(/\s+/g, " "),
            });
        });
    }
    return { total: res.length, resultados: res.slice(0, limite) };
}

// ───────────────────────── Correspondencia CC 1889 ↔ Proyecto 1851 ─────────────────────────

const VACIAS = new Set(
    ("para como pero sino este esta estos estas aquel aquella sus suya suyo cual cuales cuando donde desde hasta entre sobre " +
        "todo toda todos todas otro otra otros otras mismo misma dicho dicha dichos dichas haya hayan sera seran tiene tienen " +
        "puede pueden podra podran debe deben debera deberan cuya cuyo cuyos cuyas segun articulo articulos codigo caso casos " +
        "parte partes alguna alguno algunos algunas tambien porque menos solo")
        .split(" "),
);

export function palabras(s) {
    return norm(s)
        .replace(/[^a-zñ\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !VACIAS.has(w));
}

let indiceSimilitud;

function construirIndice(ts) {
    const docs = [];
    const df = new Map();
    for (const t of ts) {
        t.articulos.forEach((a, i) => {
            // El texto del artículo va justo tras la cabecera, antes del comentario: basta el principio.
            const { texto, paginas } = textoArticulo(t, i, 900);
            const set = new Set(palabras(texto));
            for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
            docs.push({ tomo: t.tomo, ident: t.ident, n: a.n, paginas, set });
        });
    }
    return { docs, df, N: docs.length };
}

/**
 * Artículos del Proyecto de 1851 cuyo texto se parece más al de un artículo del Código de 1889.
 * Es una búsqueda por semejanza léxica (palabras compartidas ponderadas por rareza), no una tabla
 * de concordancias: hay que comprobar el resultado en el escaneo.
 */
export async function candidatosParaTexto(texto1889, limite = 3) {
    const ts = await tomos();
    indiceSimilitud ??= construirIndice(ts);
    const { docs, df, N } = indiceSimilitud;
    const q = new Set(palabras(texto1889));
    if (!q.size) return [];
    const idf = (w) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1;
    const pesoQ = [...q].reduce((s, w) => s + idf(w), 0);
    const out = [];
    for (const d of docs) {
        let comun = 0;
        for (const w of q) if (d.set.has(w)) comun += idf(w);
        if (comun === 0) continue;
        out.push({ ...d, set: undefined, puntuacion: comun / pesoQ });
    }
    out.sort((a, b) => b.puntuacion - a.puntuacion);
    return out.slice(0, limite).map((o) => ({ ...o, puntuacion: Math.round(o.puntuacion * 100) / 100 }));
}

export function _resetIndice() {
    indiceSimilitud = undefined;
}
