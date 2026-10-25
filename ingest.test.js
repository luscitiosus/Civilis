// Ingesta de García Goyena con archive.org simulado: el _djvu.txt real del tomo 1 no separa las
// hojas con \f, y entonces todo el tomo quedaba en una sola «página» (págs. 1–1, enlace a n0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

process.env.FJ_MIN_INTERVAL_MS = "0";
process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), "goyena-"));
const goyena = await import("./goyena.js");

const HOJAS = [
    "Portada",
    "30 CONCORDANCIAS, MOTIVOS Y COMENTARIOS.\nARTICULO 18.\nSon españoles.",
    "DEL CÓDIGO CIVIL ESPAÑOL. • 51\nARTICULO lí).\nLa calidad de español se pierde.",
    "32 CONCORDANCIAS, MOTIVOS Y COMENTARIOS.\nARTÍCULO 20.\nEl español que hubiere perdido esta calidad.",
];

function simular(files) {
    globalThis.fetch = async (url) => {
        const u = String(url);
        const r = (body, type = "application/octet-stream") => new Response(body, { status: 200, headers: { "Content-Type": type } });
        if (u.includes("/metadata/BRes0414951"))
            return r(JSON.stringify({ metadata: { title: "Concordancias, motivos y comentarios… T. 1", imagecount: String(HOJAS.length) }, files: Object.keys(files).map((name) => ({ name })) }), "application/json");
        for (const [name, body] of Object.entries(files)) if (u.endsWith(`/download/BRes0414951/${encodeURIComponent(name)}`)) return r(body);
        if (u.includes("advancedsearch")) return r(JSON.stringify({ response: { docs: [] } }), "application/json");
        return new Response("no", { status: 404 });
    };
}

const leer = () => JSON.parse(readFileSync(join(process.env.CC_DATA_DIR, "goyena-1.json"), "utf-8"));

test("djvu.txt sin \\f: se pagina por las cabeceras impresas", async () => {
    simular({ "BRes0414951_djvu.txt": HOJAS.join("\n") });
    await goyena.ingest({ log: () => {}, force: true });
    const d = leer();
    assert.equal(d.formato, goyena.FORMATO);
    assert.equal(d.paginacion, "impresas");
    assert.equal(d.paginas.length, 4);
    assert.deepEqual(d.etiquetas.slice(1), [30, 31, 32]); // «• 51» se corrige a 31
    const t = goyena.prepararTomo(d);
    const a19 = t.articulos.find((a) => a.n === 19);
    assert.equal(a19.inferido, true);
    assert.equal(goyena.urlPagina(t, a19.pagina), "https://archive.org/details/BRes0414951/page/31/mode/1up");
});

test("con hOCR se pagina por hojas y se enlaza al índice de hoja", async () => {
    let txt = "";
    const indice = HOJAS.map((h) => {
        const a = Buffer.byteLength(txt);
        txt += h + "\n";
        return [a, Buffer.byteLength(txt), 0, 0];
    });
    simular({
        "BRes0414951_djvu.txt": HOJAS.join("\n"),
        "BRes0414951_hocr_pageindex.json.gz": gzipSync(JSON.stringify(indice)),
        "BRes0414951_hocr_searchtext.txt.gz": gzipSync(txt),
    });
    await goyena.ingest({ log: () => {}, force: true });
    const d = leer();
    assert.equal(d.paginacion, "hojas");
    assert.equal(d.fuente, "hOCR");
    assert.equal(d.paginas.length, 4);
    const t = goyena.prepararTomo(d);
    const a19 = t.articulos.find((a) => a.n === 19);
    assert.equal(a19.pagina, 3);
    assert.equal(goyena.urlPagina(t, a19.pagina), "https://archive.org/details/BRes0414951/page/n2/mode/1up");
    assert.equal(goyena.describirPaginas(t, 3, 3), "pág. 3 del escaneo (impresa 31)");
});

test("los ficheros del formato anterior se vuelven a descargar", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(process.env.CC_DATA_DIR, "goyena-1.json"), JSON.stringify({ tomo: 1, paginas: ["todo el tomo"] }));
    simular({ "BRes0414951_djvu.txt": HOJAS.join("\n") });
    const resumen = await goyena.ingest({ log: () => {} });
    assert.match(resumen[0], /Tomo 1: 4 páginas/);
    assert.equal(leer().formato, goyena.FORMATO);
});
