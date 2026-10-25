// Código Civil en la API de legislación consolidada del BOE (BOE-A-1889-4763).
// El BOE guarda cada artículo como un "bloque" con todas sus redacciones desde 1889,
// y cada redacción lleva notas que dicen qué norma la introdujo.
import * as cheerio from "cheerio";
import { request, SourceError } from "./http.js";
import { normalize } from "./text.js";

export const CC_ID = "BOE-A-1889-4763";
export const CC_URL = `https://www.boe.es/buscar/act.php?id=${CC_ID}`;
const API = `https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/${CC_ID}`;
const JSON_H = { Accept: "application/json" };
const XML_H = { Accept: "application/xml" };

// El Código cambia pocas veces al año: caché larga para el índice y el texto completo.
const LONG_TTL_MS = Number(process.env.CC_CACHE_TTL_MS ?? 12 * 60 * 60 * 1000);
const longCache = new Map();
async function cached(key, fn) {
    const hit = longCache.get(key);
    if (hit && Date.now() - hit.at < LONG_TTL_MS) return hit.value;
    const value = await fn();
    longCache.set(key, { at: Date.now(), value });
    return value;
}
export function _clearCache() {
    longCache.clear();
}

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

export function fechaBonita(f) {
    if (!f || !/^\d{8}/.test(f)) return f;
    return `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)}`;
}

// ───────────────────────── Índice y localización de artículos ─────────────────────────

/**
 * Interpreta el título de un bloque del índice. El BOE usa formas irregulares:
 * "Art 32", "Art. 958 bis", "Arts 127 a 130", "Art. 1231 A 1253", "Arts 307 al 313".
 * Devuelve null si el bloque no es un artículo (títulos, capítulos, disposiciones…).
 */
export function parseTituloArticulo(titulo) {
    const t = (titulo ?? "").trim();
    const m = t.match(/^(?:art[íi]culos?|arts?)\.?\s+(\d+)(?:\s+(bis|ter|quater|quinquies|sexies|septies))?(?:\s+(?:a|al|y)\s+(\d+))?\s*\.?$/i);
    if (!m) return null;
    const desde = Number(m[1]);
    const hasta = m[3] ? Number(m[3]) : desde;
    return { desde, hasta, sufijo: m[2]?.toLowerCase() ?? "", rango: Boolean(m[3]) };
}

/** "154", "art. 154", "Artículo 1.902", "94 bis" → { numero: 154, sufijo: "" }. */
export function normalizaArticulo(n) {
    const s = String(n)
        .toLowerCase()
        .replace(/^(art[íi]culo|art\.?|arts?\.?)\s*/i, "")
        .replace(/(\d)\.(\d{3})/, "$1$2")
        .replace(/\.$/, "")
        .trim();
    const m = s.match(/^(\d+)\s*(bis|ter|quater|quinquies|sexies|septies)?$/);
    if (!m) throw new SourceError(`Número de artículo no válido: "${n}". Ejemplos: "1902", "94 bis", "art. 1.255".`);
    return { numero: Number(m[1]), sufijo: m[2] ?? "" };
}

export function etiqueta({ numero, sufijo }) {
    return `art. ${numero}${sufijo ? " " + sufijo : ""} CC`;
}

export function parseIndice(json) {
    if (json?.status && String(json.status.code) !== "200") {
        throw new SourceError(`La API del BOE respondió: ${json.status.text ?? json.status.code}`);
    }
    const data = json?.data;
    const holder = Array.isArray(data) ? data[0] : data;
    return asArray(holder?.bloque).map((b) => ({ id: b.id, titulo: b.titulo ?? "", fecha_actualizacion: b.fecha_actualizacion }));
}

export async function indice() {
    const url = `${API}/texto/indice`;
    return cached(url, async () => ({ url, bloques: parseIndice(JSON.parse((await request(url, { headers: JSON_H })).text())) }));
}

/**
 * Busca el bloque de un artículo. Primero coincidencia exacta (número y sufijo);
 * si no, un bloque agrupado ("Arts 127 a 130") que lo contenga.
 */
export function localizar(bloques, articulo) {
    const a = typeof articulo === "object" ? articulo : normalizaArticulo(articulo);
    let rango;
    for (const b of bloques) {
        const p = parseTituloArticulo(b.titulo);
        if (!p) continue;
        if (!p.rango && p.desde === a.numero && p.sufijo === a.sufijo) return { bloque: b, agrupado: false };
        if (p.rango && !a.sufijo && a.numero >= p.desde && a.numero <= p.hasta && !rango) rango = b;
    }
    if (rango) return { bloque: rango, agrupado: true };
    return null;
}

// ───────────────────────── Texto con todas las versiones ─────────────────────────

const NOTA_RE = /^(Se (modifica|añade|deroga|suprime|renumera|sustituye|da nueva redacción|introduce|declara)|Queda(n)? (derogad|sin contenido|redactad)|Redactad[oa]|Téngase en cuenta|Declarad[oa]|Ref\. BOE)/i;

/** Interpreta el XML de /texto o /texto/bloque/{id}: bloques → versiones → texto y notas. */
export function parseBloquesXml(xml) {
    const $ = cheerio.load(xml, { xml: true });
    const out = [];
    $("bloque").each((_, el) => {
        const b = $(el);
        const versiones = [];
        b.children("version").each((_, v) => {
            const ver = $(v);
            const parrafos = [];
            const notas = [];
            ver.children().each((_, child) => {
                const c = $(child);
                if (c.is("blockquote")) {
                    c.find("p").each((_, p) => {
                        const t = normalize($(p).text());
                        if (!t) return;
                        if (NOTA_RE.test(t)) notas.push(t);
                        else parrafos.push("    " + t);
                    });
                } else if (c.is("table")) {
                    c.find("tr").each((_, tr) => {
                        parrafos.push($(tr).find("td,th").map((_, td) => normalize($(td).text())).get().join(" | "));
                    });
                } else {
                    const t = normalize(c.text());
                    if (t && NOTA_RE.test(t) && (c.attr("class") ?? "").includes("nota")) notas.push(t);
                    else parrafos.push(t);
                }
            });
            versiones.push({
                id_norma: ver.attr("id_norma"),
                fecha_publicacion: ver.attr("fecha_publicacion"),
                fecha_vigencia: ver.attr("fecha_vigencia"),
                texto: parrafos.filter(Boolean).join("\n"),
                notas,
            });
        });
        out.push({ id: b.attr("id") ?? "", tipo: b.attr("tipo"), titulo: b.attr("titulo") ?? "", versiones });
    });
    return out;
}

export async function bloque(id) {
    const url = `${API}/texto/bloque/${encodeURIComponent(id)}`;
    const bloques = await cached(url, async () => parseBloquesXml((await request(url, { headers: XML_H })).text()));
    if (!bloques.length) throw new SourceError(`El BOE no devolvió el bloque ${id} del Código Civil.`, url);
    return { url, bloque: bloques[0] };
}

/** Texto completo con todas las versiones (varios MB; solo para el índice de reformas). */
export async function textoCompleto() {
    const url = `${API}/texto`;
    return cached(url, async () => ({ url, bloques: parseBloquesXml((await request(url, { headers: XML_H })).text()) }));
}

// ───────────────────────── Normas modificadoras ─────────────────────────

const NORMA_RE =
    /((?:Ley Orgánica|Ley|Real Decreto-ley|Real Decreto Legislativo|Real Decreto|Decreto-ley|Decreto Legislativo|Decreto|Orden|Instrumento de Ratificación)\s+(?:\d+\/\d{4},?\s+)?de\s+\d{1,2}\s+de\s+[a-záéíóúñ]+(?:\s+de\s+\d{4})?)/i;

/**
 * Nombre de la norma que dio cada redacción, sacado de las notas del propio BOE
 * ("Se modifica por el art. 2 de la Ley 11/1981, de 13 de mayo. Ref. BOE-A-1981-11198.").
 */
export function nombresDeNormas(versiones) {
    const nombres = new Map();
    for (const v of versiones) {
        for (const nota of v.notas ?? []) {
            // Una nota puede citar varias normas: cada "Ref. BOE-…" se asocia al nombre que la precede.
            let desde = 0;
            for (const m of nota.matchAll(/Ref\.\s*(BOE-[A-Z]-\d{4}-\d+)/g)) {
                const tramo = nota.slice(desde, m.index);
                desde = m.index + m[0].length;
                const nom = [...tramo.matchAll(new RegExp(NORMA_RE.source, "gi"))].pop();
                if (nom && !nombres.has(m[1])) nombres.set(m[1], nom[1].replace(/\s+/g, " ").replace(/,$/, ""));
            }
        }
    }
    return nombres;
}

export function describirNorma(id, nombres) {
    if (id === CC_ID) return "redacción original (Real Decreto de 24 de julio de 1889)";
    return nombres.get(id) ? `${nombres.get(id)} (${id})` : id ?? "norma no indicada";
}

/** Nota del BOE que corresponde a una versión: la que cita su id_norma. */
export function notaDeVersion(v) {
    if (!v.id_norma) return undefined;
    return (v.notas ?? []).find((n) => n.includes(v.id_norma));
}

// ───────────────────────── Selección de versiones ─────────────────────────

export function aIso(f) {
    return f && /^\d{8}$/.test(f) ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : f;
}

/** Versión vigente en una fecha AAAA-MM-DD (la última cuya vigencia empezó antes o ese día). */
export function versionEnFecha(versiones, fecha) {
    const f = fecha.replace(/-/g, "");
    if (!/^\d{8}$/.test(f)) throw new SourceError(`Fecha no válida "${fecha}". Usa AAAA-MM-DD.`);
    let elegida = -1;
    versiones.forEach((v, i) => {
        if ((v.fecha_vigencia ?? "0") <= f) elegida = i;
    });
    return elegida;
}

/**
 * Resuelve un selector de versión: "original", "vigente", un número de orden (1 = original)
 * o una fecha AAAA-MM-DD. Devuelve el índice (base 0) o -1 si en esa fecha no existía.
 */
export function seleccionarVersion(versiones, sel) {
    const s = String(sel ?? "").trim().toLowerCase();
    if (!versiones.length) throw new SourceError("El bloque no tiene versiones.");
    if (s === "original" || s === "primera") return 0;
    if (s === "vigente" || s === "actual" || s === "ultima" || s === "última" || s === "") return versiones.length - 1;
    if (/^\d{1,3}$/.test(s)) {
        const n = Number(s);
        if (n < 1 || n > versiones.length) throw new SourceError(`Este artículo tiene ${versiones.length} versiones; elige de 1 a ${versiones.length}.`);
        return n - 1;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return versionEnFecha(versiones, s);
    throw new SourceError(`Selector de versión no válido: "${sel}". Usa "original", "vigente", un número (1 = original) o una fecha AAAA-MM-DD.`);
}
