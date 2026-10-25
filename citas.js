// Citas de fuentes en notación antigua, tal como las escribe García Goyena (1852), traducidas a
// notación moderna:
//   «ley 14, título 5, libro 1 del Digesto»            → D. 1.5.14
//   «ley 2, título 29, libro 6 del Código»             → C. 6.29.2
//   «ley 129 de verborum significatione»               → D. 50.16.129
//   «leyes 3 y 5, título 25, Partida 4»                → P. 4.25.3, P. 4.25.5
//   «ley 13 de Toro» · «(57 y 59 de Toro)»             → Toro 13 · Toro 57, Toro 59
//   «ley 17, título 2, libro 4 del Fuero Juzgo»        → FJ 4.2.17
//   «ley 6, título 14, libro 1, Novísima Recopilación» → Nov. Rec. 1.14.6
//
// El texto es OCR con errores: se prefiere no reconocer una cita a reconocerla mal. Los números
// tienen que leerse limpios, la cita tiene que ir precedida de «ley», «leyes», «la(s)» o
// «recopilada(s)» (o encadenada a otra cita del mismo tipo) y cada parte tiene que estar en el
// rango de la obra.

/** Minúsculas y sin acentos, sin cambiar la longitud (para conservar las posiciones). */
function plano(s) {
    let out = "";
    for (const ch of s) {
        const c = ch.normalize("NFD")[0].toLowerCase();
        out += c.length === ch.length ? c : ch.toLowerCase();
    }
    return out;
}

const NUM = "\\d{1,3}";
const NUMS = `${NUM}(?:\\s*(?:,|\\by\\b|\\be\\b)\\s*${NUM})*`;
/** Resto ilegible tras la lista de números («19 y SI'», «21)»): se ignora. */
const RUIDO = "(?:\\s*(?:,|\\by\\b)\\s*[^\\s,\\d]{1,3}(?=\\s*,)|\\))?";
const TIT = "(?:[tlu][il1]?[tl]u[l1][o0]s?|tit\\.)";
const LIB = "(?:l[i1]br[o0]s?|lib\\.)";
const DEST = {
    D: "dig[ec]s[tl][oa]|dig\\.",
    C: "c[o0]d[i1]g[o0](?!\\s+(?:civil|frances|penal|de\\s+comercio|napol|sardo|austr|holand|prus|bavar))",
    I: "institu[a-z]*",
    FJ: "fuero\\s+juzgo",
    FR: "fuero\\s+real",
    NovNav: "novisima\\s+recopilacion\\s+(?:de\\s+)?navarra",
    Nov: "novisima(?:\\s+recopilacion)?",
    Nueva: "nueva\\s+recopilacion",
};
const DEST_RE = Object.entries(DEST)
    .map(([k, v]) => `(?<${k}>${v})`)
    .join("|");

/** Rangos plausibles: [libros/partidas, títulos, leyes]. */
const RANGO = {
    D: [50, 30, 260],
    C: [12, 80, 80],
    I: [4, 30, 40],
    P: [7, 34, 130],
    FJ: [12, 8, 45],
    FR: [4, 25, 30],
    Nov: [12, 45, 60],
    NovNav: [5, 40, 60],
    Nueva: [9, 30, 60],
};

/** Número de títulos de cada libro del Digesto (1–50), para descartar lugares inexistentes. */
const TITULOS_DIGESTO = [
    22, 15, 6, 9, 6, 3, 9, 6, 4, 4, 8, 7, 7, 6, 4, 3, 2, 7, 5, 6, 3, 6, 5, 3, 7,
    10, 10, 8, 7, 1, 1, 1, 10, 9, 3, 4, 15, 17, 6, 16, 10, 8, 33, 7, 3, 8, 23, 24, 18, 17,
];

const FORMATO = {
    D: (l, t, n) => `D. ${l}.${t}.${n}`,
    C: (l, t, n) => `C. ${l}.${t}.${n}`,
    I: (l, t, n) => `I. ${l}.${t}.${n}`,
    P: (p, t, n) => `P. ${p}.${t}.${n}`,
    FJ: (l, t, n) => `FJ ${l}.${t}.${n}`,
    FR: (l, t, n) => `FR ${l}.${t}.${n}`,
    Nov: (l, t, n) => `Nov. Rec. ${l}.${t}.${n}`,
    NovNav: (l, t, n) => `Nov. Rec. Nav. ${l}.${t}.${n}`,
    Nueva: (l, t, n) => `N. Rec. ${l}.${t}.${n}`,
};

export const NOMBRE = {
    D: "Digesto",
    C: "Código de Justiniano",
    I: "Instituciones de Justiniano",
    P: "Partidas",
    Toro: "Leyes de Toro",
    FJ: "Fuero Juzgo",
    FR: "Fuero Real",
    Nov: "Novísima Recopilación",
    NovNav: "Novísima Recopilación de Navarra",
    Nueva: "Nueva Recopilación",
};
export const ROMANAS = new Set(["D", "C", "I"]);

const numeros = (s) => s.split(/\s*(?:,|\by\b|\be\b)\s*/).map(Number).filter((n) => n > 0);
const PREFIJO = /(?:\bley(?:es)?|\blas?|\brecopiladas?|\()(?:\s+\S{1,3}\s*(?:,|\by\b))?\s*$/;
const ENCADENA = /^[\s,;y()]*$/;

/**
 * Citas de un texto. Devuelve [{ fuente, ref, original, pos }] en orden de aparición, sin repetir ref.
 */
export function extraerCitas(texto) {
    const t = plano(texto);
    const grupos = [];
    const valido = (fuente, a, b, c) => {
        const r = RANGO[fuente];
        if (!(r && a >= 1 && a <= r[0] && b >= 1 && b <= r[1] && c >= 1 && c <= r[2])) return false;
        return fuente !== "D" || b <= TITULOS_DIGESTO[a - 1];
    };
    const prefijoOk = (inicio) => PREFIJO.test(t.slice(Math.max(0, inicio - 16), inicio));

    // 1. Libro, título y ley: Digesto, Código, Instituta, fueros, recopilaciones.
    const reLibro = new RegExp(
        `(recopiladas?\\s+)?(${NUMS})${RUIDO}\\s*(recopiladas?)?\\s*,?\\s*${TIT}\\s*(${NUM})\\s*,?\\s*${LIB}\\s*(${NUM})(?:\\s*,?\\s*(?:del?|de\\s+la|de\\s+las)?\\s*(?:${DEST_RE}))?`,
        "g",
    );
    for (const m of t.matchAll(reLibro)) {
        const dest = Object.keys(DEST).find((k) => m.groups[k] != null);
        const recop = Boolean(m[1] || m[3]);
        const inicio = m.index + (m[1]?.length ?? 0);
        grupos.push({
            tipo: "libro",
            fuente: dest ?? (recop ? "Nov" : null),
            leyes: numeros(m[2]),
            titulo: Number(m[4]),
            libro: Number(m[5]),
            inicio,
            fin: m.index + m[0].length,
            prefijo: recop || prefijoOk(inicio),
        });
    }

    // 2. Partidas: «ley 3, título 25, Partida 4» (y «Partida 4, título 25, ley 3»).
    const rePart = new RegExp(`(${NUMS})${RUIDO}\\s*,?\\s*${TIT}\\s*(${NUM})\\s*,?\\s*(?:de\\s+la\\s+)?partida\\s+(\\d)\\b`, "g");
    for (const m of t.matchAll(rePart)) {
        grupos.push({ tipo: "partida", fuente: "P", leyes: numeros(m[1]), titulo: Number(m[2]), libro: Number(m[3]), inicio: m.index, fin: m.index + m[0].length, prefijo: prefijoOk(m.index) });
    }
    const rePart2 = new RegExp(`partida\\s+(\\d)\\s*,\\s*${TIT}\\s*(${NUM})\\s*,\\s*ley(?:es)?\\s+(${NUMS})`, "g");
    for (const m of t.matchAll(rePart2)) {
        grupos.push({ tipo: "partida", fuente: "P", leyes: numeros(m[3]), titulo: Number(m[2]), libro: Number(m[1]), inicio: m.index, fin: m.index + m[0].length, prefijo: true });
    }

    // 3. Leyes de Toro y títulos del Digesto citados por su rúbrica.
    const reToro = new RegExp(`(${NUMS})\\s+de\\s+toro\\b`, "g");
    for (const m of t.matchAll(reToro)) {
        grupos.push({ tipo: "toro", fuente: "Toro", leyes: numeros(m[1]), inicio: m.index, fin: m.index + m[0].length, prefijo: prefijoOk(m.index) });
    }
    const reRubrica = new RegExp(`(${NUMS})\\s*,?\\s*(?:de|ele|dc|do)\\s+(?:(verb[a-z]*\\s+signif[a-z]*)|(reg[a-z]*\\s+[ij]uris))`, "g");
    for (const m of t.matchAll(reRubrica)) {
        grupos.push({ tipo: "rubrica", fuente: "D", libro: 50, titulo: m[2] ? 16 : 17, leyes: numeros(m[1]), inicio: m.index, fin: m.index + m[0].length, prefijo: prefijoOk(m.index) });
    }

    // 4. Abreviaturas: «Dig. lib. 9, tít. 2[, ley 1]» y «Cod. lib. 6, tít. 29, ley 3».
    const reAbr = /\b(dig|cod)\.?\s*lib\.?\s*(\d{1,2})\s*,\s*tit\.?\s*(\d{1,2})(?:\s*,\s*(?:ley|l\.|fr\.)\s*(\d{1,3}))?/g;
    for (const m of t.matchAll(reAbr)) {
        grupos.push({ tipo: "abrev", fuente: m[1] === "dig" ? "D" : "C", libro: Number(m[2]), titulo: Number(m[3]), leyes: m[4] ? [Number(m[4])] : [], inicio: m.index, fin: m.index + m[0].length, prefijo: true });
    }

    grupos.sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
    // Sin solapamientos: gana el que empieza antes (y, a igualdad, el más largo).
    const sinSolape = [];
    for (const g of grupos) if (!sinSolape.length || g.inicio >= sinSolape[sinSolape.length - 1].fin) sinSolape.push(g);

    // Cadenas: «leyes 12, título 2, libro 28, y 141, título 16, libro 50 del Digesto» → el primer
    // grupo toma la obra del siguiente; y un grupo encadenado no necesita «ley» delante.
    for (let i = sinSolape.length - 1; i >= 0; i--) {
        const g = sinSolape[i];
        const sig = sinSolape[i + 1];
        const unido = sig && sig.inicio - g.fin <= 8 && ENCADENA.test(t.slice(g.fin, sig.inicio));
        if (!g.fuente && unido && sig.tipo === g.tipo) g.fuente = sig.fuente;
        // «las 12, 14, título 5, libro 1, y loo, … del Digesto»: la obra va unas palabras más
        // adelante, tras un resto ilegible que no contiene otro título.
        if (!g.fuente && g.tipo === "libro") {
            const resto = t.slice(g.fin, g.fin + 50);
            const m = resto.match(new RegExp(`^([^.;]*?)\\b(?:del?|de\\s+la)\\s+(?:${DEST_RE})`));
            if (m && !new RegExp(TIT).test(m[1]) && !/partida/.test(m[1])) g.fuente = Object.keys(DEST).find((k) => m.groups[k] != null);
        }
        const ant = sinSolape[i - 1];
        g.encadenado = Boolean(ant && g.inicio - ant.fin <= 8 && ENCADENA.test(t.slice(ant.fin, g.inicio)));
    }
    for (let i = 0; i < sinSolape.length; i++) {
        const g = sinSolape[i];
        const ant = sinSolape[i - 1];
        if (!g.prefijo && g.encadenado && ant && (ant.prefijo || ant.tipo === g.tipo)) g.prefijo = true;
    }

    const out = [];
    const vistas = new Set();
    for (const g of sinSolape) {
        if (!g.fuente || !g.prefijo) continue;
        // El fragmento incluye la palabra que introduce la cita («ley», «las», «recopilada»).
        const previo = t.slice(Math.max(0, g.inicio - 16), g.inicio).match(/(?:\bley(?:es)?|\blas?|\brecopiladas?)(?:\s+\S{1,3}\s*(?:,|\by\b))?\s*$/);
        const original = texto.slice(g.inicio - (previo ? previo[0].length : 0), g.fin).replace(/\s+/g, " ").trim();
        if (g.fuente === "Toro") {
            for (const n of g.leyes) if (n >= 1 && n <= 83) push(`Toro ${n}`);
        } else if (g.tipo === "abrev" && !g.leyes.length) {
            if (valido(g.fuente, g.libro, g.titulo, 1)) push(`${g.fuente}. ${g.libro}.${g.titulo}`);
        } else {
            for (const n of g.leyes) if (valido(g.fuente, g.libro, g.titulo, n)) push(FORMATO[g.fuente](g.libro, g.titulo, n));
        }
        function push(ref) {
            if (vistas.has(ref)) return;
            vistas.add(ref);
            out.push({ fuente: g.fuente, ref, original, pos: g.inicio });
        }
    }
    return out;
}

/**
 * Normaliza una cita escrita por el usuario a la forma de `extraerCitas` (para búsquedas inversas):
 * «D. 1,5,14», «Dig. 1.5.14», «P. 4.23.5», «Partida 4, 23, 5», «4.23.5» (Partidas), «Toro 13».
 */
export function normalizaReferencia(s) {
    const t = plano(String(s)).replace(/\s+/g, " ").trim();
    let m = t.match(/^toro\s*(\d{1,2})$/) ?? t.match(/^(?:ley\s+)?(\d{1,2})\s+de\s+toro$/);
    if (m) return { fuente: "Toro", ref: `Toro ${Number(m[1])}` };
    const nums = (t.match(/\d+/g) ?? []).map(Number);
    const pref = t.replace(/[\d\s.,;:-]+.*$/, "").replace(/\.$/, "");
    const tabla = [
        [/^(d|dig|digesto|digesta)$/, "D"],
        [/^(c|cod|codigo|cj)$/, "C"],
        [/^(i|inst|instituta|instituciones)$/, "I"],
        [/^(p|part|partida|partidas|)$/, "P"],
        [/^(fj|fuero juzgo)$/, "FJ"],
        [/^(fr|fuero real)$/, "FR"],
        [/^(nov\. rec|nov rec|novisima|novisima recopilacion|nr)$/, "Nov"],
    ];
    const fuente = tabla.find(([re]) => re.test(pref))?.[1];
    if (!fuente) return null;
    if (nums.length === 2) return { fuente, ref: FORMATO[fuente](nums[0], nums[1], 0).replace(/\.0$/, ""), parcial: true };
    if (nums.length !== 3) return null;
    return { fuente, ref: FORMATO[fuente](nums[0], nums[1], nums[2]) };
}

/** ¿La cita `ref` cae dentro de `consulta` (igual, o consulta = título entero)? */
export function contiene(consulta, ref) {
    return ref === consulta || ref.startsWith(consulta + ".");
}
