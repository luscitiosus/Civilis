// Brocardos y reglas latinas, con su lugar romano y los artículos del Código Civil que los
// recogen o se apartan de ellos (brocardos.json). Cada lugar se comprobó contra BIA.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizaArticulo } from "./boe.js";
import { normalizaCita } from "./concordancias.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATOS = JSON.parse(readFileSync(join(HERE, "brocardos.json"), "utf-8"));

const plano = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

/** «7.2», «art. 7, párr. 2» → «7»; «1.255» → «1255»; «94 bis» → «94 bis». */
export function claveArticulo(articulo) {
    const s = String(articulo).trim().replace(/^(art[íi]culo|arts?\.?)\s*/i, "");
    const sub = s.match(/^(\d{1,4})\.(\d{1,2})$/);
    const a = normalizaArticulo(sub ? sub[1] : s.replace(/[,;].*$/, ""));
    return `${a.numero}${a.sufijo ? " " + a.sufijo : ""}`;
}

export function porArticulo(articulo) {
    const k = claveArticulo(articulo);
    return DATOS.brocardos.filter((b) => b.articulos.some((a) => a.articulo === k));
}

/** Por el texto del brocardo, sus variantes, la traducción o el identificador. Todas las palabras deben aparecer. */
export function buscar(consulta) {
    const ws = plano(consulta).split(" ").filter(Boolean);
    if (!ws.length) return [];
    return DATOS.brocardos.filter((b) => {
        const h = plano([b.id, b.brocardo, ...(b.alias ?? []), b.traduccion].join(" "));
        return ws.every((w) => h.includes(w));
    });
}

/** Brocardos que proceden de un lugar romano o de cualquier lugar dentro de él (D. 50.17 → D. 50.17.54). */
export function porFuente(cita) {
    const q = normalizaCita(cita);
    return DATOS.brocardos.filter((b) =>
        b.fuentes.some((f) => {
            const c = normalizaCita(f.cita);
            return c === q || c.startsWith(q + ".") || c.startsWith(q + " ");
        }),
    );
}

const RELACION = { antecedente: "antecedente", contraste: "contraste (el CC se aparta)", topico: "tópico (se cita tradicionalmente)" };
const FORMULACION = {
    literal: "la frase está en la fuente",
    equivalente: "la fuente dice lo mismo con otras palabras",
    "punto de partida": "la fuente es solo el punto de partida de una regla elaborada después",
};

export function render(b) {
    return [
        `■ ${b.brocardo}${b.alias?.length ? `  (también: ${b.alias.join("; ")})` : ""}`,
        `  «${b.traduccion}» · Formulación: ${FORMULACION[b.formulacion] ?? b.formulacion}`,
        ...b.fuentes.map((f) => `  – ${f.cita}: «${f.extracto}»`),
        `  Código Civil: ${b.articulos.map((a) => `art. ${a.articulo} (${RELACION[a.relacion] ?? a.relacion})`).join("; ")}`,
        `  ${b.nota}`,
    ].join("\n");
}
