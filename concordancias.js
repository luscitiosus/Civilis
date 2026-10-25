import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizaArticulo } from "./boe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATOS = JSON.parse(readFileSync(join(HERE, "concordancias.json"), "utf-8"));

const claveArt = (a) => `${a.numero}${a.sufijo ? " " + a.sufijo : ""}`;

export function porArticulo(articulo) {
    const k = claveArt(normalizaArticulo(articulo));
    return DATOS.entradas.filter((e) => e.articulo === k);
}

/** Normaliza una cita romanística: "Dig. 9,2,1 pr" → "D 9.2.1 pr". */
export function normalizaCita(c) {
    return c
        .trim()
        .replace(/^dig(esta)?\.?/i, "D.")
        .replace(/^inst(itutiones)?\.?/i, "I.")
        .replace(/^cod(ex)?\.?(?!\s*th)/i, "C.")
        .replace(/^gaius|^gai\.?/i, "Gai.")
        .replace(/,/g, ".")
        .replace(/\s*\.\s*(?=\d)/g, ".")
        .replace(/\bpr\.?$/i, "pr")
        .replace(/^([A-Za-z]+)\.?\s*/, (_, a) => `${a.toUpperCase() === "GAI" ? "Gai" : a.toUpperCase()} `)
        .replace(/\s+/g, " ")
        .trim();
}

/** Artículos del CC concordados con un lugar romano o con cualquier lugar dentro de él (D. 9.2 → D. 9.2.1 pr.). */
export function porFuente(cita) {
    const q = normalizaCita(cita);
    const res = [];
    for (const e of DATOS.entradas) {
        for (const f of e.fuentes) {
            const c = normalizaCita(f.cita);
            if (c === q || c.startsWith(q + ".") || c.startsWith(q + " ")) res.push({ entrada: e, fuente: f });
        }
    }
    return res;
}

/** Búsqueda por palabras en materia, institución y notas. */
export function porTexto(consulta) {
    const n = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const ws = n(consulta).split(/\s+/).filter(Boolean);
    return DATOS.entradas.filter((e) => {
        const h = n(`${e.materia} ${e.institucion} ${e.nota} ${e.fuentes.map((f) => f.extracto).join(" ")}`);
        return ws.every((w) => h.includes(w));
    });
}

export function renderEntrada(e) {
    const rel = { antecedente: "antecedente", contraste: "contraste (el CC se aparta)", topico: "tópico (lugar citado tradicionalmente)" }[e.relacion] ?? e.relacion;
    return [
        `■ Art. ${e.articulo} CC · ${e.materia}`,
        `  Institución romana: ${e.institucion}  ·  Relación: ${rel}`,
        ...e.fuentes.map((f) => `  – ${f.cita}: «${f.extracto}»`),
        `  ${e.nota}`,
    ].join("\n");
}
