// Comparación palabra a palabra entre dos redacciones (LCS sobre palabras).
// Salida legible para un modelo y para una persona: [-suprimido-] {+añadido+}.

function tokens(text) {
    // Conserva espacios y saltos para poder reconstruir el texto tal cual.
    return text.match(/\s+|[^\s]+/g) ?? [];
}

const MAX_CELLS = 4_000_000; // ~2000 × 2000 palabras

export function diffPalabras(a, b) {
    const A = tokens(a);
    const B = tokens(b);
    const n = A.length;
    const m = B.length;
    if (n * m > MAX_CELLS) {
        return { ops: [{ t: "-", s: a }, { t: "+", s: b }], aproximado: true };
    }
    // Tabla de LCS en un solo array (de abajo arriba).
    const W = m + 1;
    const L = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
        }
    }
    const ops = [];
    const push = (t, s) => {
        const last = ops[ops.length - 1];
        if (last && last.t === t) last.s += s;
        else ops.push({ t, s });
    };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (A[i] === B[j]) {
            push("=", A[i]);
            i++;
            j++;
        } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) {
            push("-", A[i++]);
        } else {
            push("+", B[j++]);
        }
    }
    while (i < n) push("-", A[i++]);
    while (j < m) push("+", B[j++]);
    return { ops, aproximado: false };
}

/**
 * Agrupa los cambios: un tramo igual de una sola palabra entre dos cambios se absorbe en ambos
 * («[-del padre y-] de [-la madre-]» se lee peor que «[-del padre y de la madre-]»).
 */
function agrupar(ops) {
    const out = [];
    let g = null;
    const flush = () => {
        if (g) out.push(g);
        g = null;
    };
    for (let k = 0; k < ops.length; k++) {
        const o = ops[k];
        if (o.t === "=") {
            const corto = o.s.trim().split(/\s+/).filter(Boolean).length <= 1 && o.s.trim().length <= 12;
            const sigueCambio = ops[k + 1] && ops[k + 1].t !== "=";
            if (g && corto && sigueCambio) {
                g.del += o.s;
                g.add += o.s;
                continue;
            }
            flush();
            out.push({ eq: o.s });
        } else {
            g ??= { del: "", add: "" };
            if (o.t === "-") g.del += o.s;
            else g.add += o.s;
        }
    }
    flush();
    return out;
}

export function renderDiff(a, b) {
    const { ops, aproximado } = diffPalabras(a, b);
    let suprimidas = 0;
    let anadidas = 0;
    const cuenta = (s) => s.trim().split(/\s+/).filter(Boolean).length;
    const txt = agrupar(ops)
        .map((x) => {
            if (x.eq !== undefined) return x.eq;
            const ref = x.del.trim() ? x.del : x.add;
            const lead = ref.match(/^\s*/)[0];
            const trail = (x.add.trim() ? x.add : x.del).match(/\s*$/)[0];
            const partes = [];
            if (x.del.trim()) {
                suprimidas += cuenta(x.del);
                partes.push(`[-${x.del.trim()}-]`);
            }
            if (x.add.trim()) {
                anadidas += cuenta(x.add);
                partes.push(`{+${x.add.trim()}+}`);
            }
            return lead + partes.join(" ") + trail;
        })
        .join("")
        .replace(/[ \t]+\n/g, "\n");
    return { texto: txt, suprimidas, anadidas, aproximado, iguales: suprimidas === 0 && anadidas === 0 };
}
