// García Goyena, Concordancias, motivos y comentarios del Código civil español (Madrid, 1852),
// comentario al Proyecto de Código civil de 1851. Ejemplar de la Biblioteca de la Universidad de
// Sevilla digitalizado en archive.org (dominio público), con texto OCR por páginas.
//
// El OCR imprime cada artículo del Proyecto como «ARTICULO 569.», a menudo con errores
// («ARTICLLO 5bl.», «AUTIGüLO 554.:»). El índice de artículos se reconstruye con tolerancia
// y con una comprobación de orden: los números deben crecer dentro de cada tomo. Las cabeceras
// cuyo número es ilegible («ARTICULO lí).») se numeran por la secuencia cuando el hueco cuadra.
//
// Páginas: el _djvu.txt de archive.org no siempre separa las hojas con \f; si no lo hace, todo
// el tomo queda en una «página». Por eso se pagina con el hOCR (índice de hojas), el _djvu.xml,
// el \f del _djvu.txt o, en último caso, las cabeceras impresas de cada página.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { request, SourceError } from "./http.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.CC_DATA_DIR ?? join(HERE, "data");

/** Versión del formato de data/goyena-*.json. Los ficheros de otra versión se vuelven a descargar. */
export const FORMATO = 2;

/** Tomos y artículos del Proyecto que comenta cada uno (según la descripción de archive.org). */
export const TOMOS = [
    { tomo: 1, ident: "BRes0414951", desde: 1, hasta: 547 },
    { tomo: 2, ident: "BRes0414952", desde: 548, hasta: 972 },
    { tomo: 3, ident: "BRes0414953", desde: 973, hasta: 1563 },
    { tomo: 4, ident: "BRes0414954", desde: 1564, hasta: 1992 },
];

/**
 * Enlace a una página del escaneo. Con un tomo paginado por hojas (lo normal) usa el índice de
 * hoja (page/nX); si solo se conocen los números impresos, usa el número impreso (page/34).
 * Admite el identificador (paginación por hojas) o el objeto tomo.
 */
export function urlPagina(tomoOIdent, p) {
    if (typeof tomoOIdent === "string") return `https://archive.org/details/${tomoOIdent}/page/n${p - 1}/mode/1up`;
    const t = tomoOIdent;
    if (t.paginacion === "impresas") {
        const et = t.etiquetas?.[p - 1];
        if (et != null) return `https://archive.org/details/${t.ident}/page/${et}/mode/1up`;
        return `https://archive.org/details/${t.ident}/mode/1up`;
    }
    return `https://archive.org/details/${t.ident}/page/n${p - 1}/mode/1up`;
}

/** «págs. 45–46 del escaneo (impresas 33–34)», «pág. 45 del escaneo (impresa 33)», o lo que se sepa. */
export function describirPaginas(tomo, desde, hasta) {
    const et = (p) => tomo.etiquetas?.[p - 1];
    const varias = et(hasta) != null && et(hasta) !== et(desde);
    const imp = et(desde) != null ? (varias ? `${et(desde)}–${et(hasta)}` : `${et(desde)}`) : null;
    if (tomo.paginacion === "impresas") return imp ? `${varias ? "págs." : "pág."} impresa${varias ? "s" : ""} ${imp}` : "página impresa no identificada";
    const esc = desde === hasta ? `pág. ${desde}` : `págs. ${desde}–${hasta}`;
    return `${esc} del escaneo${imp ? ` (impresa${varias ? "s" : ""} ${imp})` : ""}`;
}

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

const ORDINALES = {
    PRIMERO: 1, SEGUNDO: 2, TERCERO: 3, CUARTO: 4, QUINTO: 5,
    SEXTO: 6, SEPTIMO: 7, SETIMO: 7, OCTAVO: 8, NOVENO: 9, DECIMO: 10,
};

/** La palabra se parece a ARTICULO (distancia ≤ 2) y está en mayúsculas en su mayor parte. */
function esPalabraArticulo(w) {
    const palabra = sinAcentos(w).toUpperCase().replace(/0/g, "O").replace(/1/g, "I");
    const mayus = (w.match(/[A-ZÁÉÍÓÚÜÑ0-9]/g) ?? []).length / w.length;
    return mayus >= 0.6 && levenshtein(palabra, "ARTICULO") <= 2;
}

const PALABRA = "[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]{6,10}";

/**
 * Lee una línea como cabecera de artículo del Proyecto:
 *   { n }                    número legible («ARTICULO 569.», «ARTICULO l9.», «ARTÍCULO PRIMERO.»)
 *   { ilegible: true, leido } la línea es solo una cabecera, pero el número no se lee («ARTICULO lí).»)
 *   null                     no es cabecera (citas en minúsculas, cabeceras de página…)
 */
export function leerCabecera(linea) {
    const l = linea.trim();
    let m = l.match(new RegExp(`^(${PALABRA})\\.?\\s+([0-9lIOoSB|]{1,4})\\s*[.:,;·]`));
    if (m && esPalabraArticulo(m[1])) {
        const n = numeroOcr(m[2]);
        if (n != null) return { n };
    }
    m = l.match(new RegExp(`^(${PALABRA})\\.?\\s+([A-Za-zÁÉÍÓÚáéíóú]{4,9})\\s*[.:,;·]?\\s*$`));
    if (m && esPalabraArticulo(m[1])) {
        const n = ORDINALES[sinAcentos(m[2]).toUpperCase()];
        return n ? { n } : null; // «ARTICULO ADICIONAL» u otra palabra: no se numera
    }
    // Línea que es solo «ARTICULO» + un resto corto que no es una palabra: número ilegible.
    m = l.match(new RegExp(`^(${PALABRA})\\.?\\s+(\\S{1,6})\\s*$`));
    if (m && l.length <= 24 && esPalabraArticulo(m[1]) && !/^\p{L}{4,}\.?$/u.test(m[2])) {
        return { ilegible: true, leido: l };
    }
    return null;
}

/** ¿Es esta línea una cabecera «ARTICULO n.» con número legible? Devuelve n o null. */
export function cabeceraArticulo(linea) {
    return leerCabecera(linea)?.n ?? null;
}

const GUION_FIN = /(\w)[-¬]\s*\n\s*(\w)/g;

export function limpiarPagina(t) {
    return t.replace(GUION_FIN, "$1$2").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reconstruye el índice de artículos de un tomo.
 * 1. Acepta una cabecera numerada si su número está en el rango del tomo y avanza poco respecto
 *    a la anterior (o al principio del tomo), o si la siguiente la confirma.
 * 2. Las cabeceras de número ilegible, y las numeradas que se descartaron por fuera de orden, se
 *    numeran por la secuencia cuando su cantidad cuadra exactamente con el hueco entre dos
 *    artículos aceptados (p. ej. 18, «ARTICULO lí).», 20 → 19). Quedan marcadas como inferidas.
 */
export function indexarTomo(paginas, { desde, hasta }) {
    const cands = [];
    const dudosas = [];
    paginas.forEach((texto, i) => {
        let pos = 0;
        for (const l of texto.split("\n")) {
            const c = leerCabecera(l);
            if (c) {
                const base = { pagina: i + 1, pos, clave: (i + 1) * 1e8 + pos };
                if (c.n != null && c.n >= desde && c.n <= hasta) cands.push({ ...base, n: c.n, leido: l.trim() });
                else dudosas.push({ ...base, leido: l.trim(), ilegible: c.ilegible === true });
            }
            pos += l.length + 1;
        }
    });
    const arts = [];
    let ultimo = desde - 1;
    cands.forEach((c, k) => {
        const aceptar = () => {
            arts.push(c);
            ultimo = c.n;
        };
        if (c.n <= ultimo) return dudosas.push({ ...c, ilegible: false });
        const cerca = c.n - ultimo <= 12;
        const sig = cands[k + 1];
        const confirmado = sig && sig.n > c.n && sig.n - c.n <= 4;
        if (cerca || confirmado || (!arts.length && !sig)) return aceptar();
        dudosas.push({ ...c, ilegible: false });
    });
    // Huecos: entre el principio del tomo, cada artículo aceptado y el final del tomo.
    const hitos = [{ n: desde - 1, clave: -Infinity }, ...arts, { n: hasta + 1, clave: Infinity }];
    const inferidos = [];
    for (let k = 0; k + 1 < hitos.length; k++) {
        const a = hitos[k];
        const b = hitos[k + 1];
        const hueco = b.n - a.n - 1;
        if (hueco <= 0) continue;
        let dentro = dudosas.filter((d) => d.clave > a.clave && d.clave < b.clave);
        if (dentro.length > hueco) dentro = dentro.filter((d) => d.ilegible);
        if (dentro.length !== hueco) continue;
        dentro
            .sort((x, y) => x.clave - y.clave)
            .forEach((d, i) => inferidos.push({ n: a.n + 1 + i, pagina: d.pagina, pos: d.pos, clave: d.clave, inferido: true, leido: d.leido }));
    }
    return [...arts, ...inferidos]
        .sort((x, y) => x.clave - y.clave)
        .map(({ clave, ...a }) => (a.inferido ? a : { n: a.n, pagina: a.pagina, pos: a.pos }));
}

// ───────────────────────── Paginación ─────────────────────────

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const desentidad = (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
        e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m,
    );

/**
 * Páginas a partir del hOCR de archive.org: _hocr_searchtext.txt (texto) y _hocr_pageindex.json
 * (por hoja, [inicio, fin, …] en el texto). Los desplazamientos pueden ser de caracteres o de bytes:
 * se elige la unidad cuyo total cuadra con el último fin.
 */
export function paginasDesdeHocr(buf, indice) {
    const texto = buf.toString("utf-8");
    const fin = Math.max(0, ...indice.map((e) => e[1]));
    const enBytes = Math.abs(fin - buf.length) < Math.abs(fin - texto.length);
    return indice.map(([a, b]) => (enBytes ? buf.subarray(a, b).toString("utf-8") : texto.slice(a, b)));
}

/** Páginas a partir del _djvu.xml: un <OBJECT> por hoja, con LINE y WORD. */
export function paginasDesdeDjvuXml(xml) {
    const trozos = xml.split(/<OBJECT\b/i).slice(1);
    return trozos.map((t) => {
        let out = "";
        let linea = [];
        for (const m of t.matchAll(/<WORD\b[^>]*>([\s\S]*?)<\/WORD>|<\/LINE>|<\/PARAGRAPH>/gi)) {
            if (m[1] != null) linea.push(desentidad(m[1].trim()));
            else if (/LINE/i.test(m[0])) {
                out += linea.join(" ") + "\n";
                linea = [];
            } else out += "\n";
        }
        if (linea.length) out += linea.join(" ") + "\n";
        return out;
    });
}

/** Cabecera impresa de página: «34. CONCORDANCIAS, MOTIVOS Y COMENTARIOS» / «DEL CÓDIGO CIVIL ESPAÑOL. 35». */
const CABEZA_VERSO = /M[O0]T[I1lí]V\S*\s*Y\s*C[O0]MENT/i;
const CABEZA_RECTO = /C[OÓ0]D[I1lí]G[O0]\s+C[I1lí]V[I1lí]L\s+ESPA/i;
export const esCabezaPagina = (l) => l.length <= 70 && (CABEZA_VERSO.test(l) || (/^\W*DEL\s/i.test(l.trim()) && CABEZA_RECTO.test(l)));

/** Número impreso en la cabecera de una página (si se lee). */
export function numeroImpreso(texto) {
    const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const l of [...lineas.slice(0, 3), ...lineas.slice(-2)]) {
        if (!esCabezaPagina(l)) continue;
        const m = l.match(/^(\d{1,4})\b/) ?? l.match(/(\d{1,4})\s*\W*$/);
        if (m) return Number(m[1]);
    }
    return null;
}

/**
 * Números de página impresos, uno por página. Un número leído solo se acepta si concuerda con
 * otro a menos de cuatro páginas (el OCR confunde 3 con 5, 1 con 7…); luego se rellenan los
 * huecos por la secuencia, sin pasar de cuatro páginas desde un número aceptado.
 */
export function etiquetasImpresas(paginas) {
    const leidas = paginas.map(numeroImpreso);
    const ok = leidas.map((r, i) => {
        if (r == null) return null;
        for (let d = -4; d <= 4; d++) if (d && leidas[i + d] != null && leidas[i + d] - r === d) return r;
        return null;
    });
    const out = [...ok];
    for (let i = 0; i < out.length; i++) {
        if (out[i] != null) continue;
        let a = i - 1;
        while (a >= 0 && ok[a] == null && i - a <= 4) a--;
        let b = i + 1;
        while (b < out.length && ok[b] == null && b - i <= 4) b++;
        const desdeA = a >= 0 && ok[a] != null && i - a <= 4 ? ok[a] + (i - a) : null;
        const desdeB = b < out.length && ok[b] != null && b - i <= 4 ? ok[b] - (b - i) : null;
        if (desdeA != null && desdeB != null) out[i] = desdeA === desdeB ? desdeA : null;
        else out[i] = desdeA ?? desdeB;
    }
    return out;
}

/** Último recurso: parte un texto sin \f en páginas impresas, por sus cabeceras de página. */
export function paginasPorCabeceras(txt) {
    const pags = [];
    let cur = [];
    for (const l of txt.split("\n")) {
        if (esCabezaPagina(l) && cur.some((x) => x.trim())) {
            pags.push(cur.join("\n"));
            cur = [];
        }
        cur.push(l);
    }
    if (cur.length) pags.push(cur.join("\n"));
    return pags;
}

// ───────────────────────── Descarga (ingest) ─────────────────────────

async function metadatosArchive(ident) {
    const res = await request(`https://archive.org/metadata/${ident}`, { headers: { Accept: "application/json" }, noCache: true });
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
    const { paginas: brutas, paginacion, fuente } = await paginarTomo(ident, meta, log);
    const paginas = brutas.map(limpiarPagina);
    const etiquetas = etiquetasImpresas(paginas);
    const articulos = indexarTomo(paginas, t);
    const inferidos = articulos.filter((a) => a.inferido).length;
    log(
        `Tomo ${t.tomo} (${ident}): ${paginas.length} páginas (${fuente}), ` +
            `${articulos.length} artículos del Proyecto reconocidos de ${t.hasta - t.desde + 1}` +
            (inferidos ? ` (${inferidos} numerados por la secuencia)` : "") +
            `, ${etiquetas.filter((e) => e != null).length} páginas con número impreso.`,
    );
    return { formato: FORMATO, tomo: t.tomo, ident, titulo: meta.metadata?.title ?? "", desde: t.desde, hasta: t.hasta, paginacion, fuente, paginas, etiquetas };
}

const descargar = async (ident, nombre) =>
    (await request(`https://archive.org/download/${ident}/${encodeURIComponent(nombre)}`, { noCache: true })).body;
const gz = (buf, nombre) => (nombre.endsWith(".gz") ? gunzipSync(buf) : buf);

/**
 * Parte el OCR de un tomo en páginas, del método más fiable al menos:
 * hOCR (índice por hoja) → _djvu.xml (un OBJECT por hoja) → _djvu.txt con \f → cabeceras impresas.
 */
async function paginarTomo(ident, meta, log) {
    const files = (meta.files ?? []).map((f) => f.name);
    const busca = (suf) => files.find((n) => n.endsWith(suf));
    const hojas = Number(meta.metadata?.imagecount) || null;
    const plausible = (n) => n > 1 && (!hojas || n >= hojas * 0.5);
    const intentos = [
        async () => {
            const idx = busca("_hocr_pageindex.json.gz") ?? busca("_hocr_pageindex.json");
            const txt = busca("_hocr_searchtext.txt.gz") ?? busca("_hocr_searchtext.txt");
            if (!idx || !txt) return null;
            const indice = JSON.parse(gz(await descargar(ident, idx), idx).toString("utf-8"));
            const paginas = paginasDesdeHocr(gz(await descargar(ident, txt), txt), indice);
            return plausible(paginas.length) ? { paginas, paginacion: "hojas", fuente: "hOCR" } : null;
        },
        async () => {
            const xml = busca("_djvu.xml");
            if (!xml) return null;
            const paginas = paginasDesdeDjvuXml((await descargar(ident, xml)).toString("utf-8"));
            return plausible(paginas.length) ? { paginas, paginacion: "hojas", fuente: "djvu.xml" } : null;
        },
        async () => {
            const txt = busca("_djvu.txt");
            if (!txt) return null;
            const raw = (await descargar(ident, txt)).toString("utf-8");
            const porFf = raw.split("\f");
            if (plausible(porFf.length)) return { paginas: porFf, paginacion: "hojas", fuente: "djvu.txt" };
            const porCab = paginasPorCabeceras(raw);
            if (porCab.length > 10 || plausible(porCab.length)) return { paginas: porCab, paginacion: "impresas", fuente: "cabeceras de página del djvu.txt" };
            return { paginas: [raw], paginacion: "ninguna", fuente: "djvu.txt sin paginar" };
        },
    ];
    for (const intento of intentos) {
        try {
            const r = await intento();
            if (r) return r;
        } catch (e) {
            log(`${ident}: ${e instanceof Error ? e.message : e}; se prueba otra fuente de páginas.`);
        }
    }
    throw new SourceError(`${ident}: sin texto OCR utilizable (hOCR, _djvu.xml o _djvu.txt).`);
}

/** Lee un data/goyena-n.json si es del formato actual. */
function leerFichero(f) {
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
    const resumen = [];
    for (const t of TOMOS) {
        const dest = join(DATA_DIR, `goyena-${t.tomo}.json`);
        if (!force && leerFichero(dest)) {
            resumen.push(`Tomo ${t.tomo}: ya descargado.`);
            continue;
        }
        try {
            const datos = await descargarTomo(t, log);
            writeFileSync(dest, JSON.stringify(datos));
            resumen.push(`Tomo ${t.tomo}: ${datos.paginas.length} páginas (${datos.fuente}), ${indexarTomo(datos.paginas, datos).length} artículos.`);
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

/** El índice de artículos se calcula al cargar: así las mejoras del índice no exigen volver a descargar. */
export function prepararTomo(d) {
    d.articulos = indexarTomo(d.paginas, d);
    d.etiquetas ??= etiquetasImpresas(d.paginas);
    return d;
}

function leerTomos() {
    const out = [];
    for (const t of TOMOS) {
        const d = leerFichero(join(DATA_DIR, `goyena-${t.tomo}.json`));
        if (d) out.push(prepararTomo(d));
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

/**
 * Texto que precede al primer artículo reconocido de un tomo (los últimos maxChars). Sirve cuando
 * la cabecera de los primeros artículos es ilegible: su texto está justo antes.
 */
export function textoAntesDelPrimero(tomo, maxChars = 12000) {
    const a = tomo.articulos[0];
    if (!a) return null;
    const trozos = [];
    let largo = 0;
    let p = a.pagina;
    for (; p >= 1 && largo < maxChars; p--) {
        let t = tomo.paginas[p - 1];
        if (p === a.pagina) t = t.slice(0, a.pos);
        trozos.unshift(t);
        largo += t.length + 1;
    }
    const texto = trozos.join("\n");
    return { texto: texto.slice(Math.max(0, texto.length - maxChars)), paginas: { desde: p + 1, hasta: a.pagina } };
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
    if (idx >= 0) return { tomo, idx, exacto: true, inferido: tomo.articulos[idx].inferido === true };
    // Cabecera ilegible en el OCR: se devuelve el artículo reconocido anterior, cuyo tramo la contiene.
    let prev = -1;
    tomo.articulos.forEach((a, i) => {
        if (a.n < n) prev = i;
    });
    if (prev >= 0) return { tomo, idx: prev, exacto: false };
    // Antes del primer artículo reconocido del tomo: su texto precede a esa cabecera.
    if (tomo.articulos.length) return { tomo, idx: -1, exacto: false, antesDe: tomo.articulos[0].n };
    throw new SourceError(`No se ha localizado el artículo ${n} en el OCR del tomo ${tomo.tomo}.`);
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
                paginaTexto: describirPaginas(t, i + 1, i + 1),
                url: urlPagina(t, i + 1),
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
        .filter((w) => w.length >= 4 && !VACIAS.has(w))
        // Ortografía de 1851 frente a la de 1889: «estranjero/extranjero», «esceptuar/exceptuar».
        .map((w) => w.replace(/ex(?=[bcdfgjklmnpqrstvz])/g, "es"))
        .filter((w) => !VACIAS.has(w));
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
            const sig = t.articulos[i + 1];
            docs.push({
                tomo: t.tomo,
                ident: t.ident,
                n: a.n,
                paginas,
                paginaTexto: describirPaginas(t, paginas.desde, paginas.hasta),
                url: urlPagina(t, paginas.desde),
                inferido: a.inferido === true,
                // Números sin cabecera reconocida que quedan dentro de este tramo.
                tramoHasta: sig && sig.n > a.n + 1 ? sig.n - 1 : undefined,
                set,
            });
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
