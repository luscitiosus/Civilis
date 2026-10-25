import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SourceError } from "./http.js";
import { DEFAULT_MAX_CHARS, page } from "./text.js";
import * as boe from "./boe.js";
import * as goyena from "./goyena.js";
import * as conc from "./concordancias.js";
import * as citas from "./citas.js";
import * as partidas from "./partidas.js";
import * as brocardos from "./brocardos.js";
import * as code1804 from "./codigo1804.js";
import * as manresa from "./manresa.js";
import { renderDiff } from "./diff.js";

export const INSTRUCTIONS = `Concordantiae: el Código Civil español (BOE-A-1889-4763) en su historia y en sus fuentes.

Capas:
1. Historia de cada artículo desde 1889, con la norma que dio cada redacción (API oficial del BOE): cc_historia, cc_version, cc_comparar, cc_reformas.
2. Concordancias con el derecho romano, verificadas contra los textos críticos de la Bibliotheca Iuris Antiqui: cc_concordancias, cc_fuente_romana. Para leer el pasaje completo usa el conector de fuentes romanas (citar).
3. García Goyena, Concordancias, motivos y comentarios del Código civil español (1852), comentario al Proyecto de 1851, en OCR de archive.org: goyena_articulo, goyena_buscar, goyena_para_cc. Las fuentes que cita cada comentario (Digesto, Código, Partidas, Leyes de Toro, Fuero Juzgo, Fuero Real, Novísima) se leen en notación moderna con goyena_citas, y goyena_citado hace la búsqueda inversa hasta el Código Civil.
4. Derecho histórico castellano: las Siete Partidas en la edición de la Real Academia de la Historia (1807), en OCR de archive.org: historico_citar, historico_buscar.
5. El Code civil des Français de 1804 (Code Napoléon), modelo principal del Proyecto de 1851, en la transcripción de Wikisource: code_articulo, code_buscar; code_para_cc va del Código Civil al Code a través de las concordancias que da García Goyena («tomado de los 319 y 320 Franceses»).
6. Manresa, Comentarios al Código Civil español (1890 y ss.), el comentario de los años inmediatamente posteriores a la promulgación, en OCR de archive.org (se usa el ejemplar más antiguo de cada tomo): manresa_articulo, manresa_buscar.
7. Brocardos y reglas latinas con su lugar romano y los artículos que los recogen o se apartan de ellos: cc_brocardos.

Reglas:
- Cita el texto literal que devuelven las herramientas, con la fecha de vigencia y la URL. No completes con memoria lo que no se ha leído.
- Las concordancias romanas son un conjunto seleccionado, no exhaustivo: si un artículo no tiene entrada, dilo y no inventes una.
- Las citas que se extraen de García Goyena salen del OCR: un número mal leído da una cita equivocada. Compruébalas leyendo el pasaje (citar en el conector romano, historico_citar para las Partidas).
- Las concordancias con el Code que se leen en García Goyena salen del OCR (un 320 leído como 520 da otro artículo): compara siempre el texto francés con el del Proyecto y el del Código.
- Manresa es OCR del siglo XIX: cita el tomo, la edición y la página que da la herramienta, y comprueba en el escaneo.
- La numeración de las Partidas es la de la edición de 1807, que puede no coincidir con la de Gregorio López (1555), la que tenía autoridad en el foro y la que probablemente sigue García Goyena: si una cita de Goyena no cuadra con el texto, puede deberse a eso.
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
                goyena: z.boolean().default(false).describe("Añadir los candidatos del Proyecto de 1851 (García Goyena) y las fuentes que cita su comentario. Si el artículo no tiene concordancias registradas, las fuentes citadas por Goyena se añaden siempre."),
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
                const bs = brocardos.porArticulo(articulo);
                if (bs.length) out.push(`BROCARDOS relacionados (cc_brocardos):\n${bs.map(brocardos.render).join("\n\n")}`);
                if (conGoyena) out.push(await bloqueGoyena(articulo));
                if (conGoyena || !es.length) out.push(await bloqueCitasGoyena(articulo));
                if (conGoyena) out.push("CODE CIVIL DE 1804 y MANRESA: code_para_cc da los artículos del Code de los que Goyena dice tomar el del Proyecto; manresa_articulo, el comentario de Manresa.");
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
                'Búsqueda inversa: dado un lugar de las fuentes ("D. 9.2", "I. 2.1", "Gai. 3.88", "C. 8.34.3"), devuelve los artículos del Código Civil concordados con él o con cualquier lugar dentro de él, y además los comentarios de García Goyena que lo citan, con el artículo del Código que corresponde a cada uno.',
            inputSchema: { cita: z.string() },
        },
        safe(async ({ cita }) => {
            const r = conc.porFuente(cita);
            const out = [
                r.length
                    ? r.map(({ entrada, fuente }) => `art. ${entrada.articulo} CC · ${entrada.materia} — ${fuente.cita} (${entrada.relacion})`).join("\n")
                    : `Ningún artículo del conjunto de concordancias remite a ${cita}. El conjunto es selectivo; no significa que no haya relación.`,
            ];
            const bs = brocardos.porFuente(cita);
            if (bs.length) out.push(`BROCARDOS que proceden de ${cita}:\n${bs.map((b) => `  – ${b.brocardo} (${b.fuentes.map((f) => f.cita).join(", ")}) → ${b.articulos.map((a) => `art. ${a.articulo} CC`).join(", ")}`).join("\n")}`);
            const ref = citas.normalizaReferencia(cita);
            if (ref && citas.ROMANAS.has(ref.fuente)) out.push(await bloqueCitado(ref.ref, 15));
            return out.join("\n\n");
        }),
    );

    server.registerTool(
        "cc_brocardos",
        {
            title: "Brocardos y reglas latinas del Código Civil",
            description:
                'Brocardos y reglas latinas («superficies solo cedit», «pater is est quem nuptiae demonstrant», «emptio tollit locatum»…) con el lugar romano del que proceden, un extracto comprobado contra BIA, si la frase está literalmente en la fuente o es una formulación posterior, y los artículos del Código Civil que los recogen o se apartan de ellos. Busca por artículo ("358"), por palabras del brocardo o de su traducción ("solo cedit", "riesgo"), o por lugar romano ("D. 50.17"). Sin argumentos lista todos.',
            inputSchema: {
                articulo: articuloArg.optional(),
                consulta: z.string().optional().describe('Palabras del brocardo o de su traducción: "pacta", "superficies", "riesgo comprador"'),
                fuente: z.string().optional().describe('Lugar romano: "D. 50.17", "Gai. 2.73", "C. 4.65.9"'),
            },
        },
        safe(async ({ articulo, consulta, fuente }) => {
            const pie = `\n[Lugares y extractos comprobados contra BIA el ${brocardos.DATOS.verificado}. Lee el pasaje entero con citar("…") en el conector de fuentes romanas.]`;
            if (!articulo && !consulta && !fuente) {
                return `Brocardos registrados (${brocardos.DATOS.brocardos.length}):\n` + brocardos.DATOS.brocardos.map((b) => `  – ${b.brocardo} → ${b.articulos.map((a) => `art. ${a.articulo}`).join(", ")}`).join("\n") + pie;
            }
            const out = [];
            if (articulo) {
                const bs = brocardos.porArticulo(articulo);
                out.push(bs.length ? bs.map(brocardos.render).join("\n\n") : `No hay brocardos registrados para el art. ${brocardos.claveArticulo(articulo)} CC. El conjunto es selectivo (${brocardos.DATOS.brocardos.length} brocardos).`);
            }
            if (consulta) {
                const bs = brocardos.buscar(consulta);
                out.push(bs.length ? bs.map(brocardos.render).join("\n\n") : `Ningún brocardo registrado coincide con «${consulta}».`);
            }
            if (fuente) {
                const bs = brocardos.porFuente(fuente);
                out.push(bs.length ? bs.map(brocardos.render).join("\n\n") : `Ningún brocardo registrado procede de ${fuente}.`);
            }
            return out.join("\n\n") + pie;
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
                    .map(
                        (x) =>
                            `  – Proyecto art. ${x.n}${x.inferido ? " (número deducido: cabecera ilegible)" : ""} (T. ${x.tomo}, ${x.paginaTexto}) · semejanza ${x.puntuacion}` +
                            `${x.puntuacion >= 0.5 ? " · probable" : x.puntuacion < 0.25 ? " · dudosa" : ""} · ${x.url}` +
                            (x.tramoHasta ? `\n    (su tramo incluye también ${x.tramoHasta === x.n + 1 ? `el art. ${x.tramoHasta}` : `los arts. ${x.n + 1}–${x.tramoHasta}`}, de cabecera ilegible)` : ""),
                    )
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
            const { tomo, idx, exacto, inferido, antesDe } = await goyena.articuloProyecto(numero);
            const { texto, paginas } = idx >= 0 ? goyena.textoArticulo(tomo, idx, max_caracteres) : goyena.textoAntesDelPrimero(tomo, max_caracteres);
            const a = tomo.articulos[idx];
            const anterior = tomo.articulos[idx - 1]?.n;
            const posterior = tomo.articulos[idx + 1]?.n;
            let cabecera;
            if (antesDe != null)
                cabecera = `AVISO: no se ha reconocido la cabecera del art. ${numero}; el primer artículo reconocido del tomo es el ${antesDe}. Se muestra el texto que lo precede, donde debería estar el art. ${numero}: compruébalo en el escaneo.`;
            else if (!exacto)
                cabecera = `AVISO: la cabecera del art. ${numero} es ilegible en el OCR; se muestra desde el art. ${a.n}, cuyo tramo la contiene. Busca «${numero}» en el texto.`;
            else if (inferido)
                cabecera = `PROYECTO DE 1851: art. ${numero} — NÚMERO DEDUCIDO: el OCR lee «${a.leido}»; se le asigna el ${numero} por la secuencia (${anterior ?? "inicio del tomo"} → ${posterior ?? "fin del tomo"}). Compruébalo en el escaneo.`;
            else cabecera = `PROYECTO DE 1851: art. ${numero}`;
            return [
                "FUENTE: F. García Goyena, Concordancias, motivos y comentarios del Código civil español, Madrid, 1852 (ejemplar de la Universidad de Sevilla en archive.org; dominio público).",
                `TOMO: ${tomo.tomo} (${tomo.ident}) · PÁGINAS: ${goyena.describirPaginas(tomo, paginas.desde, paginas.hasta)}`,
                `ESCANEO: ${goyena.urlPagina(tomo, paginas.desde)}`,
                cabecera,
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
                    .map((r) => `• T. ${r.tomo}, ${r.paginaTexto}${r.articulo ? ` · comentario al art. ${r.articulo} del Proyecto` : ""}\n  …${r.fragmento}…\n  ${r.url}`)
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

    // ───────────────────────── Fuentes citadas por García Goyena ─────────────────────────

    const AVISO_CITAS = "Citas leídas en el OCR: un número mal leído da una cita equivocada; comprueba cada una leyendo el pasaje.";

    /** Cómo leer cada tipo de fuente desde aquí o desde otro conector. */
    function comoLeer(fuente, ref) {
        if (citas.ROMANAS.has(fuente)) return `citar("${ref}") en el conector de fuentes romanas`;
        if (fuente === "P") return `historico_citar("${ref}")`;
        return "sin texto en este conector";
    }

    /** Lista de citas agrupada por obra. */
    function renderCitas(lista) {
        const porObra = new Map();
        for (const c of lista) {
            if (!porObra.has(c.fuente)) porObra.set(c.fuente, []);
            porObra.get(c.fuente).push(c);
        }
        const orden = ["D", "C", "I", "P", "Toro", "FJ", "FR", "Nov", "Nueva", "NovNav"];
        return orden
            .filter((f) => porObra.has(f))
            .map((f) => {
                const cs = porObra.get(f);
                return `  ${citas.NOMBRE[f]} (${comoLeer(f, cs[0].ref).replace(/"[^"]*"/, '"…"')}):\n` + cs.map((c) => `    – ${c.ref}  ← «${c.original}»`).join("\n");
            })
            .join("\n");
    }

    /** Fuentes citadas en el comentario de Goyena al artículo del Proyecto que corresponde a uno del CC. */
    async function bloqueCitasGoyena(articulo) {
        try {
            const c = await cargarArticulo(articulo);
            const original = c.bloque.versiones[0];
            if (original.id_norma !== boe.CC_ID) return `FUENTES CITADAS POR GARCÍA GOYENA: el ${boe.etiqueta(c.a)} no existía en 1889; no tiene precedente en el Proyecto de 1851.`;
            const [cand] = await goyena.candidatosParaTexto(original.texto, 1);
            if (!cand || cand.puntuacion < 0.25)
                return `FUENTES CITADAS POR GARCÍA GOYENA: no hay un artículo del Proyecto de 1851 parecido al ${boe.etiqueta(c.a)}${cand ? ` (el más cercano, el ${cand.n}, solo llega a ${cand.puntuacion})` : ""}.`;
            const { tomo, idx, exacto } = await goyena.articuloProyecto(cand.n);
            if (!exacto) return `FUENTES CITADAS POR GARCÍA GOYENA: el art. ${cand.n} del Proyecto no tiene cabecera legible en el OCR; consulta goyena_articulo(${cand.n}).`;
            const lista = goyena.citasDe(tomo, idx);
            const cab = `FUENTES CITADAS POR GARCÍA GOYENA en el texto y comentario del art. ${cand.n} del Proyecto de 1851 (semejanza con el ${boe.etiqueta(c.a)}: ${cand.puntuacion}${cand.puntuacion >= 0.5 ? ", probable" : ", dudosa: comprueba que es el precedente"}).`;
            if (!lista.length) return `${cab}\n  No se ha reconocido ninguna cita en el OCR de ese comentario (puede haberlas mal leídas: goyena_articulo(${cand.n})).`;
            return `${cab}\n${AVISO_CITAS}\n${renderCitas(lista)}`;
        } catch (e) {
            return `FUENTES CITADAS POR GARCÍA GOYENA: no disponible (${e instanceof Error ? e.message : e}).`;
        }
    }

    // Proyecto de 1851 → Código de 1889: el artículo del Código cuya redacción original se parece
    // más (≥ 0,5). Necesita el Código entero del BOE: la primera vez tarda.
    let mapaPC;
    async function mapaProyectoCc() {
        if (mapaPC) return mapaPC;
        const { bloques } = await boe.textoCompleto();
        const mapa = new Map();
        for (const b of bloques) {
            const art = boe.parseTituloArticulo(b.titulo);
            const v0 = b.versiones[0];
            if (!art || art.rango || v0?.id_norma !== boe.CC_ID) continue;
            const [cand] = await goyena.candidatosParaTexto(v0.texto, 1);
            if (!cand || cand.puntuacion < 0.5) continue;
            if (!mapa.has(cand.n)) mapa.set(cand.n, []);
            mapa.get(cand.n).push({ articulo: boe.etiqueta({ numero: art.desde, sufijo: art.sufijo }), puntuacion: cand.puntuacion });
        }
        mapaPC = mapa;
        return mapa;
    }

    /** Comentarios de Goyena que citan `ref` y el artículo del Código que corresponde a cada uno. */
    async function bloqueCitado(ref, limite = 30) {
        try {
            const usos = await goyena.articulosQueCitan(ref);
            if (!usos.length) return `GARCÍA GOYENA: ningún comentario cita ${ref} (en lo que se ha podido leer del OCR).`;
            let mapa;
            try {
                mapa = await mapaProyectoCc();
            } catch {
                mapa = null;
            }
            const lineas = usos.slice(0, limite).map((u) => {
                const cc = mapa?.get(u.n)?.map((x) => `${x.articulo} (semejanza ${x.puntuacion})`).join(", ");
                return `  – ${u.ref} · comentario al art. ${u.n} del Proyecto${u.inferido ? " (número deducido)" : ""} (T. ${u.tomo})${cc ? ` → ${cc}` : mapa ? " → sin artículo del Código claramente correspondiente" : ""}\n    «${u.original}»`;
            });
            return (
                `GARCÍA GOYENA cita ${ref} en ${usos.length} lugar${usos.length === 1 ? "" : "es"}${usos.length > limite ? ` (se muestran ${limite})` : ""}:\n` +
                lineas.join("\n") +
                `\n${AVISO_CITAS}` +
                (mapa ? "" : "\n(No se ha podido cargar el Código completo del BOE para enlazar con sus artículos.)")
            );
        } catch (e) {
            return `GARCÍA GOYENA: no disponible (${e instanceof Error ? e.message : e}).`;
        }
    }

    server.registerTool(
        "goyena_citas",
        {
            title: "Fuentes que cita García Goyena en un artículo del Proyecto",
            description:
                "Lee el texto y comentario de un artículo del Proyecto de 1851 en García Goyena y devuelve, en notación moderna, las fuentes que cita: Digesto, Código e Instituciones de Justiniano (D. 1.5.14, C. 6.29.3), Partidas (P. 4.23.5), Leyes de Toro (Toro 13), Fuero Juzgo (FJ 4.2.17), Fuero Real (FR 3.5.5) y Novísima Recopilación (Nov. Rec. 10.5.2), con el fragmento del OCR de donde sale cada una. Para pasar de un artículo del Código Civil al del Proyecto usa goyena_para_cc; cc_concordancias con goyena=true lo hace todo junto.",
            inputSchema: { numero: z.number().int().min(1).max(1992) },
        },
        safe(async ({ numero }) => {
            const { tomo, idx, exacto, antesDe } = await goyena.articuloProyecto(numero);
            if (!exacto) {
                throw new SourceError(
                    antesDe != null
                        ? `No se ha reconocido la cabecera del art. ${numero} del Proyecto (el primero reconocido del tomo es el ${antesDe}); léelo con goyena_articulo(${numero}).`
                        : `La cabecera del art. ${numero} del Proyecto es ilegible en el OCR; léelo con goyena_articulo(${numero}) y busca las citas a mano.`,
                );
            }
            const lista = goyena.citasDe(tomo, idx);
            const a = tomo.articulos[idx];
            const cab = `GARCÍA GOYENA · Proyecto de 1851, art. ${numero}${a.inferido ? " (número deducido por la secuencia)" : ""} · T. ${tomo.tomo}, ${goyena.describirPaginas(tomo, a.pagina, a.pagina)}\nESCANEO: ${goyena.urlPagina(tomo, a.pagina)}`;
            if (!lista.length) return `${cab}\nNo se ha reconocido ninguna cita en el OCR de este artículo. Puede haberlas mal leídas: compruébalo con goyena_articulo(${numero}).`;
            return `${cab}\nFUENTES CITADAS (${lista.length}):\n${renderCitas(lista)}\n${AVISO_CITAS}`;
        }),
    );

    server.registerTool(
        "goyena_citado",
        {
            title: "Qué comentarios de García Goyena citan una fuente",
            description:
                'Búsqueda inversa: dado un lugar del Digesto, del Código o de las Instituciones de Justiniano, de las Partidas o de las Leyes de Toro ("D. 1.5", "C. 6.29.3", "P. 4.23", "Partida 4, título 23, ley 5", "Toro 13", también "FJ 4.2.17" o "Nov. Rec. 10.5.2"), devuelve los artículos del Proyecto de 1851 cuyo comentario lo cita y el artículo del Código Civil que corresponde a cada uno (por semejanza ≥ 0,5). Admite un título entero («D. 1.5», «P. 4.23»). La primera consulta descarga el Código completo del BOE y tarda.',
            inputSchema: { cita: z.string() },
        },
        safe(async ({ cita }) => {
            const ref = citas.normalizaReferencia(cita);
            if (!ref) throw new SourceError(`No entiendo la cita «${cita}». Ejemplos: "D. 1.5.14", "C. 6.29", "P. 4.23.5", "Partida 4, título 23, ley 5", "Toro 13", "FJ 4.2.17".`);
            return bloqueCitado(ref.ref);
        }),
    );

    // ───────────────────────── Derecho histórico: Partidas ─────────────────────────

    server.registerTool(
        "historico_citar",
        {
            title: "Ley de las Partidas",
            description:
                'Texto OCR de una ley de las Siete Partidas en la edición de la Real Academia de la Historia (1807), con su rúbrica y enlace a la página escaneada: "P. 4.23.5", "Partida 4, título 23, ley 5" o "4.23.5". Dice además qué comentarios de García Goyena la citan. La numeración es la de 1807, que puede no coincidir con la de Gregorio López (1555). Las Leyes de Toro, el Fuero Juzgo, el Fuero Real y la Novísima aún no tienen texto en el conector.',
            inputSchema: {
                referencia: z.string(),
                max_caracteres: z.number().int().min(1000).max(40000).default(8000),
            },
        },
        safe(async ({ referencia, max_caracteres }) => {
            const ref = citas.normalizaReferencia(referencia);
            if (!ref) throw new SourceError(`No entiendo la referencia «${referencia}». Ejemplos: "P. 4.23.5", "Partida 4, título 23, ley 5".`);
            if (ref.fuente !== "P") {
                throw new SourceError(`${citas.NOMBRE[ref.fuente] ?? ref.fuente}: el conector todavía no tiene su texto (solo las Partidas). Puedes ver qué comentarios de García Goyena lo citan con goyena_citado("${ref.ref}").`);
            }
            const [p, t, l] = ref.ref.replace(/^P\. /, "").split(".").map(Number);
            if (!l) throw new SourceError(`Indica la ley: "P. ${p}.${t}.1", "P. ${p}.${t}.2"…`);
            const r = await partidas.ley(p, t, l, max_caracteres);
            const e = r.entrada;
            const cab = [
                `FUENTE: ${partidas.EDICION}.`,
                `TOMO: ${r.tomo.tomo} (${r.tomo.ident}) · PÁGINAS: ${r.paginaTexto}`,
                `ESCANEO: ${r.url}`,
                `PARTIDA ${partidas.aRomano(p)}, TÍTULO ${partidas.aRomano(t)}${r.titulo?.rubrica ? ` — ${r.titulo.rubrica}` : ""}`,
                r.exacto
                    ? `LEY ${partidas.aRomano(l)} (${ref.ref})${e.rubrica ? ` — ${e.rubrica}` : ""}`
                    : `AVISO: no se ha reconocido la cabecera de la ley ${partidas.aRomano(l)} en el OCR (el título tiene al menos ${r.leyesDelTitulo} leyes reconocidas). Se muestra desde ${e.l ? `la ley ${partidas.aRomano(e.l)}` : "el comienzo del título"}, cuyo tramo la contiene: busca «LEY ${partidas.aRomano(l)}» en el texto.`,
                "NUMERACIÓN: la de la edición de 1807, que puede no coincidir con la de Gregorio López (1555), la que tenía autoridad en el foro y la que probablemente sigue García Goyena.",
            ];
            let citadaPor = "";
            try {
                const usos = await goyena.articulosQueCitan(ref.ref);
                if (usos.length) citadaPor = `\nCITADA POR GARCÍA GOYENA en el comentario a${usos.length === 1 ? "l art." : " los arts."} ${[...new Set(usos.map((u) => u.n))].join(", ")} del Proyecto de 1851 (goyena_citado("${ref.ref}") da el artículo del Código).`;
            } catch {
                /* Goyena no disponible: se omite. */
            }
            return [...cab, "TEXTO OCR (puede contener errores de lectura; compruébalo en el escaneo antes de citar):", "────────────────────────────────────────", r.texto].join("\n") + citadaPor;
        }),
    );

    server.registerTool(
        "historico_buscar",
        {
            title: "Buscar en las Partidas",
            description: "Busca palabras en el OCR de las Siete Partidas (edición de 1807). Devuelve la ley en que cae cada resultado, un fragmento y el enlace al escaneo. La ortografía es la medieval: «fijo», «home», «muger», «facer».",
            inputSchema: {
                consulta: z.string(),
                partida: z.number().int().min(1).max(7).optional(),
                limite: z.number().int().min(1).max(50).default(10),
            },
        },
        safe(async ({ consulta, partida, limite }) => {
            const { total, resultados } = await partidas.buscar(consulta, { partida, limite });
            if (!total) return `Sin resultados para «${consulta}» en las Partidas (prueba la grafía medieval o una forma más corta: el OCR puede haber leído mal la palabra).`;
            return (
                `${total} páginas contienen «${consulta}»${partida ? ` en la Partida ${partida}` : ""}:\n\n` +
                resultados
                    .map((r) => `• ${r.donde ? (r.donde.l ? `P. ${r.donde.p}.${r.donde.t}.${r.donde.l}` : `P. ${r.donde.p}.${r.donde.t} (antes de su primera ley)`) : `T. ${r.tomo}, antes del primer título reconocido`} · ${r.paginaTexto}\n  …${r.fragmento}…\n  ${r.url}`)
                    .join("\n\n")
            );
        }),
    );

    // ───────────────────────── Code civil des Français (1804) ─────────────────────────

    const CAB_CODE = () => `FUENTE: ${code1804.OBRA}; ${code1804.FUENTE}. Edición oficial escaneada: ${code1804.URL_GALLICA}`;

    /** Comentarios de Goyena que citan el art. n del Code, con el artículo del CC que corresponde. */
    async function bloqueGoyenaCode(n) {
        try {
            const usos = await code1804.goyenaQueCita(goyena, n);
            if (!usos.length) return `GARCÍA GOYENA: no se ha leído ninguna remisión al art. ${n} del Code en el OCR (puede haberlas mal leídas).`;
            let mapa;
            try {
                mapa = await mapaProyectoCc();
            } catch {
                mapa = null;
            }
            return (
                `GARCÍA GOYENA lo da como fuente de ${usos.length === 1 ? "un artículo" : `${usos.length} artículos`} del Proyecto de 1851:\n` +
                usos
                    .map((u) => {
                        const cc = mapa?.get(u.proyecto)?.map((x) => `${x.articulo} (semejanza ${x.puntuacion})`).join(", ");
                        return `  – Proyecto art. ${u.proyecto}${u.inferido ? " (número deducido)" : ""} (T. ${u.tomo})${cc ? ` → ${cc}` : mapa ? " → sin artículo del Código claramente correspondiente" : ""}\n    «${u.original}»`;
                    })
                    .join("\n") +
                "\n  Remisiones leídas en el OCR: comprueba que el texto del Code corresponde."
            );
        } catch (e) {
            return `GARCÍA GOYENA: no disponible (${e instanceof Error ? e.message : e}).`;
        }
    }

    server.registerTool(
        "code_articulo",
        {
            title: "Artículo del Code civil de 1804",
            description:
                "Texto original de un artículo del Code civil des Français de 1804 (Code Napoléon), con el Livre, Titre y Chapitre en que está y el enlace a la transcripción de Wikisource. Dice además qué artículos del Proyecto de 1851 lo toman como fuente según García Goyena y el artículo del Código Civil que corresponde a cada uno.",
            inputSchema: { numero: z.number().int().min(1).max(2281), goyena: z.boolean().default(true).describe("Añadir las remisiones de García Goyena a este artículo (la primera vez recorre todo Goyena y tarda)") },
        },
        safe(async ({ numero, goyena: conGoyena }) => {
            const a = await code1804.articulo(numero);
            const ctx = code1804.describirContexto(a.contexto);
            const out = [
                CAB_CODE(),
                `TRANSCRIPCIÓN: ${a.url}`,
                `CODE CIVIL (1804), art. ${numero}${ctx ? `\nUBICACIÓN: ${ctx}` : ""}`,
                "TEXTO (francés, redacción de 1804):",
                "────────────────────────────────────────",
                a.texto,
            ];
            if (conGoyena) out.push("", await bloqueGoyenaCode(numero));
            return out.join("\n");
        }),
    );

    server.registerTool(
        "code_buscar",
        {
            title: "Buscar en el Code civil de 1804",
            description: "Busca palabras en francés en el texto del Code civil de 1804 («propriété du sol», «enfant conçu», «même événement»). Devuelve los artículos con un fragmento.",
            inputSchema: { consulta: z.string(), limite: z.number().int().min(1).max(50).default(10) },
        },
        safe(async ({ consulta, limite }) => {
            const { total, resultados } = await code1804.buscar(consulta, limite);
            if (!total) return `Sin resultados para «${consulta}» en el Code de 1804 (busca en francés de la época: «loix», «enfans» también aparecen).`;
            return (
                `${total} artículos del Code de 1804 contienen «${consulta}»${total > resultados.length ? ` (se muestran ${resultados.length})` : ""}:\n\n` +
                resultados.map((a) => `• art. ${a.n}${a.contexto?.titre ? ` · ${a.contexto.titre}` : ""}\n  ${a.texto.replace(/\s+/g, " ").slice(0, 300)}${a.texto.length > 300 ? "…" : ""}`).join("\n\n")
            );
        }),
    );

    server.registerTool(
        "code_para_cc",
        {
            title: "Del Código Civil al Code de 1804",
            description:
                "Para un artículo del Código Civil busca su precedente en el Proyecto de 1851 (García Goyena, por semejanza con la redacción de 1889) y lee en el comentario de Goyena los artículos del Code civil de 1804 de los que dice tomarlo («tomado de los 319 y 320 Franceses»), con su texto francés. Las remisiones salen del OCR y hay que comprobarlas.",
            inputSchema: { articulo: articuloArg, textos: z.boolean().default(true).describe("Incluir el texto francés de cada artículo del Code") },
        },
        safe(async ({ articulo, textos }) => {
            const c = await cargarArticulo(articulo);
            const original = c.bloque.versiones[0];
            if (original.id_norma !== boe.CC_ID) return `El ${boe.etiqueta(c.a)} no existía en 1889 (lo introdujo ${boe.describirNorma(original.id_norma, c.nombres)}): no tiene precedente en el Proyecto de 1851 ni, por esa vía, en el Code.`;
            const cands = (await goyena.candidatosParaTexto(original.texto, 3)).filter((x) => x.puntuacion >= 0.25);
            if (!cands.length) return `No hay un artículo del Proyecto de 1851 suficientemente parecido al ${boe.etiqueta(c.a)} (semejanza < 0,25): sin esa pasarela no se puede leer en Goyena su fuente francesa. Prueba code_buscar con palabras del artículo en francés.`;
            const out = [`${boe.etiqueta(c.a).toUpperCase()} → PROYECTO DE 1851 → CODE CIVIL DE 1804`, `Redacción de 1889: ${original.texto.replace(/^Artículo [^\n]*\n/, "").replace(/\s+/g, " ").slice(0, 400)}`];
            for (const cand of cands.slice(0, 2)) {
                const { tomo, idx, exacto } = await goyena.articuloProyecto(cand.n);
                out.push("", `■ Proyecto art. ${cand.n} (semejanza ${cand.puntuacion}${cand.puntuacion >= 0.5 ? ", probable" : ", dudosa"}) · García Goyena T. ${cand.tomo}, ${cand.paginaTexto} · ${cand.url}`);
                if (!exacto) {
                    out.push(`  La cabecera del art. ${cand.n} no se lee en el OCR; consulta goyena_articulo(${cand.n}).`);
                    continue;
                }
                const fr = code1804.citasFrancesasDe(tomo, idx, goyena.textoArticulo);
                if (!fr.length) {
                    out.push("  Goyena no remite al Code en este artículo (o la remisión no se lee en el OCR).");
                    continue;
                }
                out.push(`  Goyena lo da como tomado de: ${[...new Set(fr.map((x) => x.original))].map((o) => `«${o}»`).join("; ")}`);
                for (const { n } of fr) {
                    if (!textos) {
                        out.push(`  – Code art. ${n}`);
                        continue;
                    }
                    try {
                        const a = await code1804.articulo(n);
                        out.push(`  – Code art. ${n}${a.contexto?.titre ? ` (${a.contexto.titre})` : ""}: ${a.texto.replace(/\s+/g, " ").slice(0, 600)}`);
                    } catch (e) {
                        out.push(`  – Code art. ${n}: ${e instanceof Error ? e.message : e}`);
                    }
                }
            }
            out.push("", `[${CAB_CODE()}. Las remisiones de Goyena salen del OCR: si el texto francés no corresponde, el número puede estar mal leído (520 por 320); mira el escaneo de Goyena.]`);
            return out.join("\n");
        }),
    );

    // ───────────────────────── Manresa, Comentarios (1890 y ss.) ─────────────────────────

    server.registerTool(
        "manresa_articulo",
        {
            title: "Manresa: comentario a un artículo del Código Civil",
            description:
                "Texto OCR del comentario de José María Manresa y Navarro (Comentarios al Código Civil español, 1890 y ss.) a un artículo del Código Civil, con tomo, edición, año, página y enlace al escaneo de archive.org. Se usa el ejemplar más antiguo digitalizado de cada tomo (normalmente la 1.ª edición). Los comentarios son largos: usa offset para seguir leyendo.",
            inputSchema: { articulo: articuloArg, offset, max_caracteres: z.number().int().min(1000).max(60000).default(12000) },
        },
        safe(async ({ articulo, offset, max_caracteres }) => {
            const a = boe.normalizaArticulo(articulo);
            if (a.sufijo) return `El ${boe.etiqueta(a)} es posterior a Manresa: los artículos bis y ter se introdujeron en reformas del siglo XX y no tienen comentario en su obra.`;
            const r = await manresa.comentario(a.numero);
            const e = r.entrada;
            const ns = e.ns.length > 1 ? `arts. ${e.ns.join(", ")}` : `art. ${e.ns[0]}`;
            const cab = [
                `FUENTE: ${manresa.OBRA}. Ejemplar en archive.org (dominio público).`,
                `TOMO: ${r.tomo.tomo} (${r.tomo.ident}) · ${manresa.describirEdicion(r.tomo)} · PÁGINAS: ${manresa.paginasDe(r.tomo, r.paginas.desde, r.paginas.hasta)}`,
                `ESCANEO: ${manresa.urlDe(r.tomo, r.paginas.desde)}`,
                r.exacto
                    ? `COMENTARIO AL ${ns.toUpperCase()} CC${e.ns.length > 1 ? " (Manresa los comenta juntos)" : ""}`
                    : `AVISO: no se ha reconocido la cabecera del art. ${a.numero} en el OCR; se muestra desde el ${ns}, cuyo tramo lo contiene. Busca «${a.numero}» en el texto.`,
                "AVISO: Manresa comenta la redacción de su época (1889 o la de la edición), no la vigente: contrástala con cc_version.",
            ];
            if (r.truncado) cab.push("AVISO: el tramo es muy largo y se ha cortado; sigue en el escaneo.");
            let fuentes = "";
            if (offset === 0) {
                const lista = citas.extraerCitas(r.texto);
                if (lista.length) fuentes = `\n\nFUENTES QUE CITA (leídas en el OCR; compruébalas):\n${renderCitas(lista)}`;
            }
            return [...cab, "TEXTO OCR (puede contener errores de lectura; compruébalo en el escaneo antes de citar):", "────────────────────────────────────────", page(r.texto, offset, max_caracteres)].join("\n") + fuentes;
        }),
    );

    server.registerTool(
        "manresa_buscar",
        {
            title: "Buscar en Manresa",
            description: "Busca palabras en el OCR de los Comentarios de Manresa. Devuelve el tomo, el artículo comentado en esa página, un fragmento y el enlace al escaneo.",
            inputSchema: { consulta: z.string(), tomo: z.number().int().min(1).max(12).optional(), limite: z.number().int().min(1).max(50).default(10) },
        },
        safe(async ({ consulta, tomo, limite }) => {
            const { total, resultados } = await manresa.buscar(consulta, { tomo, limite });
            if (!total) return `Sin resultados para «${consulta}» en Manresa (el OCR puede haber leído mal la palabra: prueba una forma más corta).`;
            return (
                `${total} páginas contienen «${consulta}»${total > resultados.length ? ` (se muestran ${resultados.length})` : ""}:\n\n` +
                resultados
                    .map((r) => `• T. ${r.tomo}, ${r.paginaTexto}${r.articulos ? ` · comentario al art. ${r.articulos.join(", ")}` : ""}\n  …${r.fragmento}…\n  ${r.url}`)
                    .join("\n\n")
            );
        }),
    );

    return server;
}
