import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SourceError } from "./http.js";
import { DEFAULT_MAX_CHARS, page } from "./text.js";
import * as boe from "./boe.js";
import * as goyena from "./goyena.js";
import * as conc from "./concordancias.js";
import { renderDiff } from "./diff.js";

export const INSTRUCTIONS = `Concordantiae: el Código Civil español (BOE-A-1889-4763) en su historia y en sus fuentes.

Tres capas:
1. Historia de cada artículo desde 1889, con la norma que dio cada redacción (API oficial del BOE): cc_historia, cc_version, cc_comparar, cc_reformas.
2. Concordancias con el derecho romano, verificadas contra los textos críticos de la Bibliotheca Iuris Antiqui: cc_concordancias, cc_fuente_romana. Para leer el pasaje completo usa el conector de fuentes romanas (citar).
3. García Goyena, Concordancias, motivos y comentarios del Código civil español (1852), comentario al Proyecto de 1851, en OCR de archive.org: goyena_articulo, goyena_buscar, goyena_para_cc.

Reglas:
- Cita el texto literal que devuelven las herramientas, con la fecha de vigencia y la URL. No completes con memoria lo que no se ha leído.
- Las concordancias romanas son un conjunto seleccionado, no exhaustivo: si un artículo no tiene entrada, dilo y no inventes una.
- El texto de García Goyena es OCR del siglo XIX con errores; la correspondencia entre artículos del Proyecto de 1851 y del Código de 1889 que ofrece goyena_para_cc es por semejanza textual y debe comprobarse en el escaneo enlazado.`;

const ok = (text) => ({ content: [{ type: "text", text }] });
function fail(err) {
    const msg = err instanceof Error ? err.message : String(err);
    const url = err instanceof SourceError && err.url ? `\nURL consultada: ${err.url}` : "";
    return { isError: true, content: [{ type: "text", text: `ERROR (no se ha obtenido el texto; no completes con memoria): ${msg}${url}` }] };
}
const safe = (fn) => async (a) => {
    try {
        return ok(await fn(a));
    } catch (e) {
        return fail(e);
    }
};

const articuloArg = z.string().describe('Número de artículo del Código Civil: "1902", "94 bis", "art. 1.255"');
const offset = z.number().int().min(0).default(0).describe("Posición desde la que leer (textos largos)");
const maxChars = z.number().int().min(1000).max(200000).default(DEFAULT_MAX_CHARS);

/** Bloque del BOE con todas las versiones de un artículo, más los nombres de las normas. */
async function cargarArticulo(articulo) {
    const a = boe.normalizaArticulo(articulo);
    const { bloques } = await boe.indice();
    const loc = boe.localizar(bloques, a);
    if (!loc) {
        throw new SourceError(`No hay ${boe.etiqueta(a)} en el índice del BOE. El Código llega al art. 1976 (más los bis y ter añadidos).`);
    }
    const { url, bloque } = await boe.bloque(loc.bloque.id);
    const nombres = boe.nombresDeNormas(bloque.versiones);
    return { a, loc, url, bloque, nombres, urlOficial: `${boe.CC_URL}#${loc.bloque.id}` };
}

function cabecera(c, extra = []) {
    const lineas = [
        `FUENTE: BOE · Código Civil consolidado (${boe.CC_ID})`,
        `PRECEPTO: ${boe.etiqueta(c.a)}${c.loc.agrupado ? ` — el BOE lo agrupa en el bloque «${c.loc.bloque.titulo}»` : ""}`,
        ...extra,
        `URL OFICIAL: ${c.urlOficial}`,
        `API: ${c.url}`,
        `CONSULTADO: ${new Date().toISOString()}`,
    ];
    return lineas.join("\n");
}

function lineaVersion(v, i, total, nombres) {
    const desde = boe.fechaBonita(v.fecha_vigencia) ?? "?";
    return `${i + 1}/${total} · vigente desde ${desde} · ${boe.describirNorma(v.id_norma, nombres)}`;
}

function intervalo(versiones, i) {
    const desde = boe.fechaBonita(versiones[i].fecha_vigencia);
    const sig = versiones[i + 1];
    return sig ? `del ${desde} al día anterior al ${boe.fechaBonita(sig.fecha_vigencia)}` : `desde el ${desde} (vigente)`;
}

export function createServer() {
    const server = new McpServer({ name: "concordantiae", version: "0.1.0" }, { instructions: INSTRUCTIONS });

    // ───────────────────────────── Historia (BOE) ─────────────────────────────

    server.registerTool(
        "cc_historia",
        {
            title: "Historia de un artículo del Código Civil",
            description:
                "Todas las redacciones de un artículo del Código Civil desde 1889, con su fecha de vigencia y la norma que introdujo cada una (Ley 11/1981, Ley 13/2005…). Con textos=false da solo la cronología.",
            inputSchema: { articulo: articuloArg, textos: z.boolean().default(true).describe("Incluir el texto de cada versión"), offset, max_caracteres: maxChars },
        },
        safe(async ({ articulo, textos, offset, max_caracteres }) => {
            const c = await cargarArticulo(articulo);
            const vs = c.bloque.versiones;
            const crono = vs.map((v, i) => lineaVersion(v, i, vs.length, c.nombres)).join("\n");
            let cuerpo = `CRONOLOGÍA (${vs.length} ${vs.length === 1 ? "versión: conserva la redacción original" : "versiones"}):\n${crono}`;
            if (textos) {
                cuerpo +=
                    "\n\nTEXTOS LITERALES:\n────────────────────────────────────────\n" +
                    vs.map((v, i) => `[Versión ${lineaVersion(v, i, vs.length, c.nombres)}]\n${v.texto}`).join("\n\n");
            }
            return `${cabecera(c)}\n\n${page(cuerpo, offset, max_caracteres)}`;
        }),
    );

    server.registerTool(
        "cc_version",
        {
            title: "Redacción de un artículo en una fecha",
            description:
                'Texto de un artículo del Código Civil tal como estaba vigente en una fecha (AAAA-MM-DD), o una versión concreta: "original", "vigente" o su número de orden (1 = original). Útil para leer sentencias o manuales antiguos.',
            inputSchema: {
                articulo: articuloArg,
                version: z.string().default("vigente").describe('Fecha AAAA-MM-DD, "original", "vigente" o número (1 = original)'),
            },
        },
        safe(async ({ articulo, version }) => {
            const c = await cargarArticulo(articulo);
            const vs = c.bloque.versiones;
            const i = boe.seleccionarVersion(vs, version);
            if (i < 0) {
                return `${cabecera(c)}\n\nEl ${boe.etiqueta(c.a)} no existía el ${version}: su primera redacción entró en vigor el ${boe.fechaBonita(vs[0].fecha_vigencia)} (${boe.describirNorma(vs[0].id_norma, c.nombres)}).`;
            }
            const v = vs[i];
            return [
                cabecera(c, [
                    `VERSIÓN: ${lineaVersion(v, i, vs.length, c.nombres)}`,
                    `VIGENCIA: ${intervalo(vs, i)}`,
                ]),
                "TEXTO LITERAL (tal como lo sirve el BOE):",
                "────────────────────────────────────────",
                v.texto,
                ...(vs.length > 1 ? [`\n[El artículo tiene ${vs.length} versiones. cc_historia las lista; cc_comparar muestra los cambios.]`] : []),
            ].join("\n");
        }),
    );

    server.registerTool(
        "cc_comparar",
        {
            title: "Comparar dos redacciones de un artículo",
            description:
                'Muestra palabra a palabra qué cambió entre dos versiones de un artículo del Código Civil: [-suprimido-] {+añadido+}. Por defecto compara la redacción original de 1889 con la vigente. Cada extremo admite "original", "vigente", un número de orden o una fecha AAAA-MM-DD.',
            inputSchema: {
                articulo: articuloArg,
                desde: z.string().default("original"),
                hasta: z.string().default("vigente"),
            },
        },
        safe(async ({ articulo, desde, hasta }) => {
            const c = await cargarArticulo(articulo);
            const vs = c.bloque.versiones;
            const i = boe.seleccionarVersion(vs, desde);
            const j = boe.seleccionarVersion(vs, hasta);
            if (i < 0 || j < 0) throw new SourceError(`El artículo no existía en la fecha indicada (primera redacción: ${boe.fechaBonita(vs[0].fecha_vigencia)}).`);
            if (vs.length === 1) return `${cabecera(c)}\n\nEl ${boe.etiqueta(c.a)} conserva su redacción original de 1889: no hay cambios que comparar.\n\n${vs[0].texto}`;
            const d = renderDiff(vs[i].texto, vs[j].texto);
            const entre = vs
                .slice(Math.min(i, j) + 1, Math.max(i, j) + 1)
                .map((v, k) => `  · ${lineaVersion(v, Math.min(i, j) + 1 + k, vs.length, c.nombres)}`)
                .join("\n");
            return [
                cabecera(c, [`DE: ${lineaVersion(vs[i], i, vs.length, c.nombres)}`, `A:  ${lineaVersion(vs[j], j, vs.length, c.nombres)}`]),
                "",
                i === j ? "Es la misma versión." : `Reformas intermedias que explican el cambio:\n${entre}`,
                "",
                d.iguales ? "El texto es idéntico en ambas versiones (la reforma pudo afectar solo a notas o a la numeración)." : `CAMBIOS (${d.suprimidas} palabras suprimidas, ${d.anadidas} añadidas)${d.aproximado ? " — texto demasiado largo para comparar palabra a palabra; se muestran ambas versiones completas" : ""}:`,
                "────────────────────────────────────────",
                d.texto,
            ].join("\n");
        }),
    );

    server.registerTool(
        "cc_reformas",
        {
            title: "Reformas del Código Civil",
            description:
                'Con "norma" (un identificador BOE-A-… o un nombre como "Ley 8/2021" o "Ley 13/2005"), lista los artículos del Código Civil a los que dio redacción. Sin norma, lista las normas que han reformado el Código en un intervalo de fechas, con el número de artículos afectados. Descarga el Código completo con su historia (puede tardar la primera vez).',
            inputSchema: {
                norma: z.string().optional(),
                desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha de vigencia mínima"),
                hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha de vigencia máxima"),
            },
        },
        safe(async ({ norma, desde, hasta }) => {
            const { url, bloques } = await boe.textoCompleto();
            const todas = bloques.flatMap((b) => b.versiones);
            const nombres = boe.nombresDeNormas(todas);
            // id_norma → artículos y fecha de vigencia
            const mapa = new Map();
            for (const b of bloques) {
                const p = boe.parseTituloArticulo(b.titulo);
                const nombreBloque = p ? `art. ${p.desde}${p.sufijo ? " " + p.sufijo : ""}${p.rango ? `–${p.hasta}` : ""}` : b.titulo || b.id;
                b.versiones.forEach((v, i) => {
                    if (i === 0 && v.id_norma === boe.CC_ID) return;
                    const k = v.id_norma ?? "?";
                    if (!mapa.has(k)) mapa.set(k, { fecha: v.fecha_vigencia, preceptos: [] });
                    mapa.get(k).preceptos.push(nombreBloque);
                });
            }
            const pie = `\n\nFUENTE: BOE · ${url}`;
            if (norma) {
                const q = norma.trim();
                const id = /^BOE-/i.test(q)
                    ? q.toUpperCase()
                    : [...nombres].find(([, n]) => n.toLowerCase().replace(/\s+/g, " ").includes(q.toLowerCase().replace(/\s+/g, " ")))?.[0];
                if (!id || !mapa.has(id)) {
                    throw new SourceError(`No consta que "${norma}" haya dado redacción a ningún precepto del Código Civil. Prueba con el identificador BOE-A-… o con el número exacto (p. ej. "Ley 11/1981").`);
                }
                const r = mapa.get(id);
                return `${boe.describirNorma(id, nombres)} — vigente desde ${boe.fechaBonita(r.fecha)}\nDio redacción a ${r.preceptos.length} preceptos del Código Civil:\n${r.preceptos.join(", ")}${pie}`;
            }
            const d = (desde ?? "0000-00-00").replace(/-/g, "");
            const h = (hasta ?? "9999-99-99").replace(/-/g, "");
            const lista = [...mapa]
                .filter(([, r]) => (r.fecha ?? "") >= d && (r.fecha ?? "") <= h)
                .sort((x, y) => (x[1].fecha ?? "").localeCompare(y[1].fecha ?? ""))
                .map(([id, r]) => `${boe.fechaBonita(r.fecha)} · ${boe.describirNorma(id, nombres)} · ${r.preceptos.length} preceptos`);
            return `Normas que han dado redacción a preceptos del Código Civil${desde || hasta ? ` (vigencia entre ${desde ?? "1889"} y ${hasta ?? "hoy"})` : ""}: ${lista.length}\n\n${lista.join("\n")}${pie}`;
        }),
    );

    // ───────────────────────────── Concordancias romanas ─────────────────────────────

    server.registerTool(
        "cc_concordancias",
        {
            title: "Fuentes romanas de un artículo del Código Civil",
            description:
                "Concordancias de un artículo del Código Civil con el Digesto, las Instituciones de Gayo y de Justiniano y el Código de Justiniano: lugar exacto, extracto latino, si el CC recoge o se aparta de la regla romana, y una nota. Con goyena=true añade los artículos del Proyecto de 1851 más parecidos en García Goyena. También admite una búsqueda por palabras (consulta).",
            inputSchema: {
                articulo: articuloArg.optional(),
                consulta: z.string().optional().describe('Palabras de la materia o institución: "usufructo", "lex Aquilia", "tesoro"'),
                goyena: z.boolean().default(false).describe("Añadir candidatos del Proyecto de 1851 (García Goyena)"),
            },
        },
        safe(async ({ articulo, consulta, goyena: conGoyena }) => {
            if (!articulo && !consulta) {
                const lista = conc.DATOS.entradas.map((e) => `art. ${e.articulo} · ${e.materia}`).join("\n");
                return `Artículos con concordancias romanas (${conc.DATOS.entradas.length}):\n${lista}`;
            }
            let out = [];
            if (articulo) {
                const es = conc.porArticulo(articulo);
                out.push(
                    es.length
                        ? es.map(conc.renderEntrada).join("\n\n")
                        : `No hay concordancias romanas registradas para el ${boe.etiqueta(boe.normalizaArticulo(articulo))}. El conjunto es selectivo (${conc.DATOS.entradas.length} artículos); no supongas que no existen. Prueba con una consulta por materia o busca en las fuentes con el conector romano.`,
                );
                if (conGoyena) out.push(await bloqueGoyena(articulo));
            }
            if (consulta) {
                const es = conc.porTexto(consulta);
                out.push(es.length ? `Coincidencias para «${consulta}»:\n\n${es.map(conc.renderEntrada).join("\n\n")}` : `Sin coincidencias para «${consulta}».`);
            }
            out.push(`\n[Citas comprobadas contra BIA (Mommsen-Krueger; Gayo ed. David) el ${conc.DATOS.verificado}. Lee el pasaje entero con el conector de fuentes romanas: citar("D. 9.2.1 pr.").]`);
            return out.join("\n\n");
        }),
    );

    server.registerTool(
        "cc_fuente_romana",
        {
            title: "Qué artículos del Código Civil remontan a un lugar romano",
            description:
                'Búsqueda inversa: dado un lugar de las fuentes ("D. 9.2", "I. 2.1", "Gai. 3.88", "C. 8.34.3"), devuelve los artículos del Código Civil concordados con él o con cualquier lugar dentro de él.',
            inputSchema: { cita: z.string() },
        },
        safe(async ({ cita }) => {
            const r = conc.porFuente(cita);
            if (!r.length) return `Ningún artículo del conjunto de concordancias remite a ${cita}. El conjunto es selectivo; no significa que no haya relación.`;
            return r.map(({ entrada, fuente }) => `art. ${entrada.articulo} CC · ${entrada.materia} — ${fuente.cita} (${entrada.relacion})`).join("\n");
        }),
    );

    // ───────────────────────────── García Goyena ─────────────────────────────

    async function bloqueGoyena(articulo) {
        try {
            const c = await cargarArticulo(articulo);
            const original = c.bloque.versiones[0];
            if (original.id_norma !== boe.CC_ID) {
                return `GARCÍA GOYENA: el ${boe.etiqueta(c.a)} no existía en 1889 (lo introdujo ${boe.describirNorma(original.id_norma, c.nombres)}); no tiene precedente en el Proyecto de 1851.`;
            }
            const cands = await goyena.candidatosParaTexto(original.texto, 3);
            if (!cands.length) return "GARCÍA GOYENA: sin candidatos por semejanza textual.";
            return (
                "GARCÍA GOYENA — artículos del Proyecto de 1851 más parecidos a la redacción de 1889 (semejanza léxica; compruébalo en el escaneo):\n" +
                cands
                    .map((x) => `  – Proyecto art. ${x.n} (T. ${x.tomo}, págs. ${x.paginas.desde}–${x.paginas.hasta}) · semejanza ${x.puntuacion}${x.puntuacion >= 0.5 ? " · probable" : x.puntuacion < 0.25 ? " · dudosa" : ""} · ${goyena.urlPagina(x.ident, x.paginas.desde)}`)
                    .join("\n") +
                "\n  Lee el comentario con goyena_articulo."
            );
        } catch (e) {
            return `GARCÍA GOYENA: no disponible (${e instanceof Error ? e.message : e}).`;
        }
    }

    server.registerTool(
        "goyena_articulo",
        {
            title: "García Goyena: artículo del Proyecto de 1851 y su comentario",
            description:
                "Texto OCR del artículo n del Proyecto de Código civil de 1851 con las concordancias (códigos extranjeros, derecho romano, Partidas) y el comentario de García Goyena (1852), con enlace a la página escaneada. Los números son los del Proyecto, no los del Código de 1889: usa goyena_para_cc para pasar de uno a otro.",
            inputSchema: { numero: z.number().int().min(1).max(1992), max_caracteres: z.number().int().min(1000).max(40000).default(12000) },
        },
        safe(async ({ numero, max_caracteres }) => {
            const { tomo, idx, exacto } = await goyena.articuloProyecto(numero);
            const { texto, paginas } = goyena.textoArticulo(tomo, idx, max_caracteres);
            const a = tomo.articulos[idx];
            return [
                "FUENTE: F. García Goyena, Concordancias, motivos y comentarios del Código civil español, Madrid, 1852 (ejemplar de la Universidad de Sevilla en archive.org; dominio público).",
                `TOMO: ${tomo.tomo} (${tomo.ident}) · PÁGINAS DEL ESCANEO: ${paginas.desde}–${paginas.hasta}`,
                `ESCANEO: ${goyena.urlPagina(tomo.ident, paginas.desde)}`,
                exacto
                    ? `PROYECTO DE 1851: art. ${numero}`
                    : `AVISO: la cabecera del art. ${numero} es ilegible en el OCR; se muestra desde el art. ${a.n}, cuyo tramo la contiene. Busca «${numero}» en el texto.`,
                "TEXTO OCR (puede contener errores de lectura; compruébalo en el escaneo antes de citar):",
                "────────────────────────────────────────",
                texto,
            ].join("\n");
        }),
    );

    server.registerTool(
        "goyena_buscar",
        {
            title: "Buscar en García Goyena",
            description:
                "Busca palabras en el OCR de los cuatro tomos de García Goyena (1852). Devuelve página, artículo del Proyecto comentado y enlace al escaneo. Útil para localizar citas del Digesto o de las Partidas («ley Aquilia», «Partida 5»).",
            inputSchema: { consulta: z.string(), tomo: z.number().int().min(1).max(4).optional(), limite: z.number().int().min(1).max(50).default(10) },
        },
        safe(async ({ consulta, tomo, limite }) => {
            const { total, resultados } = await goyena.buscar(consulta, { tomo, limite });
            if (!total) return `Sin resultados para «${consulta}» (el OCR puede haber leído mal la palabra: prueba una forma más corta).`;
            return (
                `${total} páginas contienen «${consulta}»${total > resultados.length ? ` (se muestran ${resultados.length})` : ""}:\n\n` +
                resultados
                    .map((r) => `• T. ${r.tomo}, pág. ${r.pagina}${r.articulo ? ` · comentario al art. ${r.articulo} del Proyecto` : ""}\n  …${r.fragmento}…\n  ${goyena.urlPagina(r.ident, r.pagina)}`)
                    .join("\n\n")
            );
        }),
    );

    server.registerTool(
        "goyena_para_cc",
        {
            title: "Del Código de 1889 al Proyecto de 1851",
            description:
                "Propone los artículos del Proyecto de 1851 que corresponden a un artículo del Código Civil, comparando la redacción original de 1889 (BOE) con el texto del Proyecto en García Goyena. Es una semejanza textual con puntuación de 0 a 1, no una tabla oficial.",
            inputSchema: { articulo: articuloArg },
        },
        safe(async ({ articulo }) => bloqueGoyena(articulo)),
    );

    return server;
}
