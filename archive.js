// Descarga de libros escaneados de archive.org y su partición en páginas (hojas del escaneo).
// Lo usan García Goyena (goyena.js) y las Partidas (partidas.js).
import { gunzipSync } from "node:zlib";
import { request, SourceError } from "./http.js";

export async function metadatosArchive(ident) {
    const res = await request(`https://archive.org/metadata/${ident}`, { headers: { Accept: "application/json" }, noCache: true });
    return JSON.parse(res.text());
}

/** Busca en archive.org un identificador cuyo título cumpla `re`. */
export async function buscarIdent(q, re) {
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&rows=20&output=json`;
    const json = JSON.parse((await request(url, { noCache: true })).text());
    const docs = json?.response?.docs ?? [];
    return docs.find((d) => re.test(d.title ?? ""))?.identifier;
}

/**
 * Metadatos de un tomo. Si el identificador previsto no existe o su título no cumple `re`,
 * se busca otro con la consulta `q`.
 */
export async function localizarTomo({ ident, re, q, etiqueta, log = () => {} }) {
    let meta;
    try {
        meta = await metadatosArchive(ident);
    } catch {
        meta = undefined;
    }
    const titulo = meta?.metadata?.title ?? "";
    if (meta?.files && re.test(titulo)) return { ident, meta };
    log(`${etiqueta}: ${ident} no coincide (${titulo || "sin metadatos"}); buscando en archive.org…`);
    const otro = await buscarIdent(q, re).catch(() => undefined);
    if (!otro) throw new SourceError(`No se ha encontrado ${etiqueta} en archive.org.`);
    return { ident: otro, meta: await metadatosArchive(otro) };
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

const descargar = async (ident, nombre) =>
    (await request(`https://archive.org/download/${ident}/${encodeURIComponent(nombre)}`, { noCache: true })).body;
const gz = (buf, nombre) => (nombre.endsWith(".gz") ? gunzipSync(buf) : buf);

/**
 * Parte el OCR de un tomo en páginas, del método más fiable al menos:
 * hOCR (índice por hoja) → _djvu.xml (un OBJECT por hoja) → _djvu.txt con \f → cabeceras impresas.
 */
export async function paginarTomo(ident, meta, log = () => {}, { porCabeceras } = {}) {
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
            const porCab = porCabeceras ? porCabeceras(raw) : [];
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
