// José María Manresa y Navarro, Comentarios al Código Civil español (Madrid, 1890 y ss.), con la
// colaboración de varios jurisconsultos e introducción de Francisco de Cárdenas. Es el comentario
// de los años inmediatamente posteriores a la promulgación: hace con el Código de 1889 lo que
// García Goyena hace con el Proyecto de 1851.
//
// Fuente: ejemplares digitalizados en archive.org (dominio público), con OCR. La Universidad de
// Sevilla tiene dos series: la primera edición (Imprenta de la Revista de Legislación, 1890 y ss.;
// signatura B Res.045534, p. ej. BRes0455341 para el T. 1) y la 4.ª edición (Reus, signatura
// B Res.040526). Para cada tomo se busca en archive.org y se elige el ejemplar MÁS ANTIGUO, de modo
// que se usa la primera edición siempre que esté digitalizada; la edición y el año efectivamente
// usados se guardan y se muestran en cada consulta.
//
// El OCR imprime cada artículo como «ARTÍCULO 1088» (a veces «ARTÍCULO 1.088.» o «ARTÍCULOS 1089
// Y 1090»). El índice se reconstruye con esas cabeceras, exigiendo que los números avancen.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request, SourceError } from "./http.js";
import { metadatosArchive, paginarTomo } from "./archive.js";
import { DATA_DIR, limpiarPagina, sinAcentos, urlPagina, describirPaginas, etiquetasImpresas, unirGuiones } from "./goyena.js";

export const FORMATO = 1;
export const OBRA = "J. M. Manresa y Navarro, Comentarios al Código Civil español, con la colaboración de varios jurisconsultos y una introducción de F. de Cárdenas";

/** Tomos de la obra. `ident` es la primera edición en la Universidad de Sevilla (comprobado el T. 1). */
export const TOMOS = Array.from({ length: 12 }, (_, i) => ({ tomo: i + 1, ident: `BRes045534${i + 1}` }));

// ───────────────────────── Cabeceras ─────────────────────────

function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

/** La palabra se parece a ARTÍCULO o ARTÍCULOS y va en mayúsculas en su mayor parte. */
function esArticulo(w) {
    const p = sinAcentos(w).toUpperCase().replace(/0/g, "O").replace(/1/g, "I");
    const mayus = (w.match(/[A-ZÁÉÍÓÚÜÑ0-9]/g) ?? []).length / w.length;
    if (mayus >= 0.6) return levenshtein(p, "ARTICULO") <= 2 || levenshtein(p, "ARTICULOS") <= 2;
    // Versalitas leídas como «Artículo»: se admite con mayúscula inicial y bien escrito, nunca «artículo».
    return /^[AÁ]/.test(w) && /^ARTICULOS?$/.test(p);
}

/** «1.088» → 1088; tolera l/I/O/S/B leídos por cifras. */
function numero(tok) {
    const s = tok.replace(/\.(?=\d{3}\b)/, "").replace(/[lIi|]/g, "1").replace(/[oO]/g, "0").replace(/S/g, "5").replace(/B/g, "8");
    return /^\d{1,4}$/.test(s) && Number(s) >= 1 && Number(s) <= 1976 ? Number(s) : null;
}

const ORDINALES = { PRIMERO: 1, SEGUNDO: 2, TERCERO: 3, CUARTO: 4, QUINTO: 5, SEXTO: 6, SEPTIMO: 7, SETIMO: 7, OCTAVO: 8, NOVENO: 9, DECIMO: 10, UNICO: null };
const NUM = "[0-9lIOoSB|]{1,2}(?:\\.[0-9lIOoSB|]{3}|[0-9lIOoSB|]{0,2})";

/**
 * Lee una línea como cabecera de artículo(s) del Código:
 *   «ARTÍCULO 1088» · «ARTÍCULO 1.088.» · «ARTICULO PRIMERO.» → [1088] · [1]
 *   «ARTÍCULOS 1089 Y 1090.» · «ARTÍCULOS 1091 al 1094» · «ARTÍCULOS 7, 8 y 9» → [1089, 1090]…
 * Solo vale si la línea es la cabecera sola (las remisiones en el texto van en minúscula y
 * seguidas de más palabras). Devuelve la lista de números o null.
 */
export function leerCabecera(linea) {
    const l = linea.trim();
    if (l.length > 60) return null;
    const m = l.match(new RegExp(`^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]{6,11})\\.?\\s+((?:${NUM})(?:\\s*(?:,|y|Y|e|al|AL|á|a)\\s*(?:${NUM}))*)\\s*[.:,;·]?\\s*$`));
    if (m && esArticulo(m[1])) {
        const nums = [];
        const partes = m[2].split(/\s*(?:,|\by\b|\bY\b|\be\b)\s*/);
        for (const p of partes) {
            const r = p.match(new RegExp(`^(${NUM})\\s*(?:al|AL|á|a)\\s*(${NUM})$`));
            if (r) {
                const [a, b] = [numero(r[1]), numero(r[2])];
                if (a && b && b > a && b - a <= 15) for (let k = a; k <= b; k++) nums.push(k);
                else return null;
            } else {
                const n = numero(p);
                if (n == null) return null;
                nums.push(n);
            }
        }
        const ok = nums.every((n, i) => i === 0 || n > nums[i - 1]);
        return ok && nums.length ? nums : null;
    }
    const o = l.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{6,11})\.?\s+([A-Za-zÁÉÍÓÚáéíóú]{4,9})\s*[.:]?\s*$/);
    if (o && esArticulo(o[1])) {
        const n = ORDINALES[sinAcentos(o[2]).toUpperCase()];
        return n ? [n] : null;
    }
    return null;
}

/**
 * Índice de un tomo: [{ ns: [números], pagina, pos }], en orden. Una cabecera se acepta si su
 * primer número sigue al último aceptado (salto ≤ 15) o si la confirma la siguiente (≤ 6); la
 * primera del tomo necesita esa confirmación, porque no se sabe con qué artículo empieza.
 */
export function indexarTomo(paginas) {
    const cands = [];
    paginas.forEach((texto, i) => {
        let pos = 0;
        for (const l of texto.split("\n")) {
            const ns = leerCabecera(l);
            if (ns) cands.push({ ns, pagina: i + 1, pos });
            pos += l.length + 1;
        }
    });
    const out = [];
    let ultimo = 0;
    cands.forEach((c, k) => {
        const n = c.ns[0];
        if (n <= ultimo) return;
        const fin = c.ns.at(-1);
        const sig = cands.slice(k + 1, k + 4).find((x) => x.ns[0] > fin);
        const confirmada = sig && sig.ns[0] - fin <= 6;
        if ((ultimo > 0 && n - ultimo <= 15) || confirmada || (!out.length && k === cands.length - 1)) {
            out.push(c);
            ultimo = fin;
        }
    });
    return out;
}

// ───────────────────────── Localización de la primera edición ─────────────────────────

const año = (d) => {
    const m = String(d ?? "").match(/\b(1[89]\d\d)\b/);
    return m ? Number(m[1]) : Infinity;
};
const reTomo = (n) => new RegExp(`\\bT\\.?\\s*0*${n}(?!\\d)`, "i");

/** Ejemplares de Manresa en archive.org: [{ identifier, title, date, publisher }]. */
async function ejemplares() {
    const q = 'creator:(manresa) AND title:("comentarios al codigo civil")';
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=date&fl[]=year&fl[]=publisher&rows=200&output=json`;
    const json = JSON.parse((await request(url, { noCache: true })).text());
    return json?.response?.docs ?? [];
}

/**
 * El ejemplar más antiguo de un tomo. Si la búsqueda falla, se prueba el identificador previsto.
 * Devuelve { ident, meta }.
 */
export async function localizarTomo(t, docs, log = () => {}) {
    const cands = (docs ?? [])
        .filter((d) => reTomo(t.tomo).test(String(d.title ?? "")) && /manresa|c[oó]digo civil/i.test(`${d.title} ${d.creator ?? ""}`))
        .sort((a, b) => año(a.date ?? a.year) - año(b.date ?? b.year) || (a.identifier === t.ident ? -1 : b.identifier === t.ident ? 1 : 0));
    for (const c of cands) {
        try {
            const meta = await metadatosArchive(c.identifier);
            if (meta?.files?.length) return { ident: c.identifier, meta };
        } catch {
            /* se prueba el siguiente */
        }
    }
    log(`Manresa T. ${t.tomo}: sin resultados de búsqueda; se prueba ${t.ident}.`);
    const meta = await metadatosArchive(t.ident).catch(() => undefined);
    const titulo = meta?.metadata?.title ?? "";
    if (meta?.files?.length && /coment/i.test(titulo) && reTomo(t.tomo).test(titulo)) return { ident: t.ident, meta };
    throw new SourceError(`No se ha encontrado el tomo ${t.tomo} de Manresa en archive.org.`);
}

const texto = (v) => (Array.isArray(v) ? v.join("; ") : v ?? "");

/** Descripción de la edición a partir de los metadatos de archive.org. */
export function edicionDe(meta) {
    const m = meta?.metadata ?? {};
    const desc = sinAcentos(`${texto(m.edition)} ${texto(m.description)} ${texto(m.title)}`);
    const ed = desc.match(/\b(\d{1,2})\s*[.ªa]{1,2}\s*ed(?:icion|\.)?/i);
    return {
        fecha: texto(m.date) || texto(m.year),
        editorial: texto(m.publisher),
        edicion: ed ? `${ed[1]}.ª ed.` : año(m.date) <= 1891 ? "1.ª ed." : "",
        titulo: texto(m.title),
    };
}

// ───────────────────────── Descarga y carga ─────────────────────────

/** Número impreso: cifra sola al principio o al final de la primera o la última línea. */
export function numeroImpreso(t) {
    const ls = t.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const l of [...ls.slice(0, 2), ...ls.slice(-1)]) {
        if (l.length > 70) continue;
        const m = l.match(/^(\d{1,4})\b(?!\.\d)/) ?? l.match(/\b(\d{1,4})\s*$/);
        if (m && !/ART[IÍ]CULO/i.test(l)) return Number(m[1]);
    }
    return null;
}

const fichero = (tomo) => join(DATA_DIR, `manresa-${tomo}.json`);

function leerFichero(f) {
    if (!existsSync(f)) return null;
    try {
        const d = JSON.parse(readFileSync(f, "utf-8"));
        return d.formato === FORMATO ? d : null;
    } catch {
        return null;
    }
}

async function descargarTomo(t, docs, log) {
    const { ident, meta } = await localizarTomo(t, docs, log);
    const { paginas: brutas, paginacion, fuente } = await paginarTomo(ident, meta, log);
    const paginas = brutas.map(limpiarPagina);
    const indice = indexarTomo(paginas);
    const ed = edicionDe(meta);
    const rango = indice.length ? `arts. ${indice[0].ns[0]}–${indice.at(-1).ns.at(-1)}` : "sin artículos reconocidos";
    log(`Manresa T. ${t.tomo} (${ident}, ${ed.fecha} ${ed.edicion}): ${paginas.length} páginas (${fuente}), ${indice.length} cabeceras, ${rango}.`);
    return { formato: FORMATO, tomo: t.tomo, ident, ...ed, paginacion, fuente, paginas };
}

export async function ingest({ log = console.error, force = false } = {}) {
    mkdirSync(DATA_DIR, { recursive: true });
    const resumen = [];
    let docs;
    for (const t of TOMOS) {
        if (!force && leerFichero(fichero(t.tomo))) {
            resumen.push(`Manresa, tomo ${t.tomo}: ya descargado.`);
            continue;
        }
        try {
            docs ??= await ejemplares().catch((e) => (log(`Manresa: búsqueda en archive.org fallida (${e instanceof Error ? e.message : e}).`), []));
            const d = await descargarTomo(t, docs, log);
            writeFileSync(fichero(t.tomo), JSON.stringify(d));
            const idx = indexarTomo(d.paginas);
            resumen.push(`Manresa, tomo ${t.tomo}: ${d.ident} (${d.fecha}${d.edicion ? ", " + d.edicion : ""}), ${d.paginas.length} páginas, ${idx.length} cabeceras de artículo.`);
        } catch (e) {
            const msg = `Manresa, tomo ${t.tomo}: ERROR ${e instanceof Error ? e.message : e}`;
            log(msg);
            resumen.push(msg);
        }
    }
    return resumen;
}

export function prepararTomo(d) {
    d.indice = indexarTomo(d.paginas);
    d.etiquetas ??= etiquetasImpresas(d.paginas, numeroImpreso);
    d.desde = d.indice[0]?.ns[0] ?? null;
    d.hasta = d.indice.at(-1)?.ns.at(-1) ?? null;
    return d;
}

let cargados;
let cargaEnCurso;

const leerTomos = () => TOMOS.map((t) => leerFichero(fichero(t.tomo))).filter(Boolean).map(prepararTomo);

export async function tomos() {
    if (cargados) return cargados;
    let t = leerTomos();
    if (t.length < TOMOS.length && process.env.CC_GOYENA_AUTOINGEST !== "0") {
        cargaEnCurso ??= ingest({ log: () => {} }).finally(() => (cargaEnCurso = undefined));
        await cargaEnCurso;
        t = leerTomos();
    }
    if (!t.length) throw new SourceError("Los Comentarios de Manresa no están disponibles: no se pudieron descargar de archive.org (https://archive.org/details/BRes0455341 es el T. 1).");
    cargados = t;
    return t;
}

export function _setTomos(t) {
    cargados = t.map(prepararTomo);
}

// ───────────────────────── Consulta ─────────────────────────

const clave = (x) => x.pagina * 1e8 + x.pos;

/** Texto de una entrada del índice hasta la cabecera siguiente (como mucho, `maxPaginas` hojas). */
function tramo(tomo, k, maxPaginas = 60) {
    const a = tomo.indice[k];
    const sig = tomo.indice[k + 1];
    const finPag = sig ? sig.pagina : Math.min(a.pagina + maxPaginas, tomo.paginas.length);
    const trozos = [];
    for (let p = a.pagina; p <= Math.min(finPag, a.pagina + maxPaginas); p++) {
        let t = tomo.paginas[p - 1];
        if (sig && p === sig.pagina) t = t.slice(0, sig.pos);
        if (p === a.pagina) t = t.slice(a.pos);
        trozos.push(t);
    }
    return { texto: trozos.join("\n"), paginas: { desde: a.pagina, hasta: Math.min(finPag, a.pagina + maxPaginas) }, truncado: finPag > a.pagina + maxPaginas };
}

/**
 * Comentario de Manresa a un artículo del Código. Si la cabecera del artículo no se ha reconocido,
 * devuelve la del anterior del mismo tomo, cuyo tramo lo contiene (exacto: false).
 */
export async function comentario(n) {
    const ts = await tomos();
    for (const tomo of ts) {
        const k = tomo.indice.findIndex((x) => x.ns.includes(n));
        if (k >= 0) return { tomo, entrada: tomo.indice[k], exacto: true, ...tramo(tomo, k) };
    }
    const tomo = ts.find((t) => t.desde != null && n > t.desde && n < t.hasta);
    if (tomo) {
        let k = -1;
        tomo.indice.forEach((x, i) => {
            if (x.ns[0] < n) k = i;
        });
        return { tomo, entrada: tomo.indice[k], exacto: false, ...tramo(tomo, k) };
    }
    const rangos = ts
        .filter((t) => t.desde != null)
        .map((t) => `T. ${t.tomo}: ${t.desde}–${t.hasta}`)
        .join("; ");
    const faltan = TOMOS.filter((t) => !ts.some((x) => x.tomo === t.tomo)).map((t) => t.tomo);
    throw new SourceError(
        `No se ha localizado el comentario al art. ${n} en los tomos descargados (${rangos || "ninguno con artículos reconocidos"})` +
            (faltan.length ? `; faltan los tomos ${faltan.join(", ")}` : "") +
            ".",
    );
}

export const urlDe = urlPagina;
export const paginasDe = describirPaginas;

const norm = (s) => unirGuiones(sinAcentos(s).toLowerCase());

export async function buscar(consulta, { tomo, limite = 10 } = {}) {
    const ts = (await tomos()).filter((t) => !tomo || t.tomo === tomo);
    const ws = norm(consulta).split(/\s+/).filter((w) => w.length > 1);
    if (!ws.length) throw new SourceError("Escribe al menos una palabra.");
    const res = [];
    for (const t of ts) {
        t.paginas.forEach((pag, i) => {
            const np = norm(pag);
            if (!ws.every((w) => np.includes(w))) return;
            const at = np.indexOf(ws[0]);
            const k = (i + 1) * 1e8 + at;
            let art;
            for (const x of t.indice) if (clave(x) <= k) art = x.ns;
            const ini = Math.max(0, at - 160);
            res.push({ tomo: t.tomo, articulos: art, url: urlPagina(t, i + 1), paginaTexto: describirPaginas(t, i + 1, i + 1), fragmento: pag.slice(ini, ini + 360).replace(/\s+/g, " ") });
        });
    }
    return { total: res.length, resultados: res.slice(0, limite) };
}

export function describirEdicion(tomo) {
    return [tomo.edicion, tomo.editorial, tomo.fecha].filter(Boolean).join(", ") || "edición sin datos en archive.org";
}
