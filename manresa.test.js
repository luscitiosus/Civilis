import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FJ_MIN_INTERVAL_MS = "0";
process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), "manresa-"));
const manresa = await import("./manresa.js");

test("Manresa: cabeceras de artículo", () => {
    assert.deepEqual(manresa.leerCabecera("ARTÍCULO 1088"), [1088]);
    assert.deepEqual(manresa.leerCabecera("ARTÍCULO 1.088."), [1088]);
    assert.deepEqual(manresa.leerCabecera("ARTICULO 1O89."), [1089]);
    assert.deepEqual(manresa.leerCabecera("AKTÍCULO 358."), [358]);
    assert.deepEqual(manresa.leerCabecera("Artículo 32."), [32]);
    assert.deepEqual(manresa.leerCabecera("ARTÍCULOS 1089 Y 1090."), [1089, 1090]);
    assert.deepEqual(manresa.leerCabecera("ARTÍCULOS 1091 al 1094"), [1091, 1092, 1093, 1094]);
    assert.deepEqual(manresa.leerCabecera("ARTÍCULOS 7, 8 y 9"), [7, 8, 9]);
    assert.deepEqual(manresa.leerCabecera("ARTÍCULO PRIMERO."), [1]);
    for (const no of ["artículo 1091.", "Artículo 1091 del Código francés", "ART. 1091", "ARTÍCULO 2500", "ARTÍCULOS 9 y 7", "ARTÍCULO ÚNICO."]) {
        assert.equal(manresa.leerCabecera(no), null, no);
    }
});

test("Manresa: índice de un tomo, con cabeceras falsas y fuera de orden", () => {
    const pags = [
        "LIBRO CUARTO\nARTÍCULO 7\nfalso: no lo confirma ninguna siguiente",
        "ARTÍCULO 1088\nToda obligación consiste en dar, hacer ó no hacer alguna cosa.",
        "ARTÍCULOS 1089 Y 1090.\ntexto\nARTÍCULO 1089\nrepetida: no avanza",
        "ARTÍCULO 1091\nLas obligaciones que nacen de los contratos…",
        "ARTICULO 1O93.\nx",
    ];
    const idx = manresa.indexarTomo(pags);
    assert.deepEqual(idx.map((x) => x.ns), [[1088], [1089, 1090], [1091], [1093]]);
    assert.deepEqual(idx.map((x) => x.pagina), [2, 3, 4, 5]);
});

test("Manresa: edición a partir de los metadatos", () => {
    assert.deepEqual(manresa.edicionDe({ metadata: { date: "1890", publisher: "Madrid : Imprenta de la Revista de Legislación", title: "Comentarios al Código Civil español T. 1" } }), {
        fecha: "1890",
        editorial: "Madrid : Imprenta de la Revista de Legislación",
        edicion: "1.ª ed.",
        titulo: "Comentarios al Código Civil español T. 1",
    });
    assert.equal(manresa.edicionDe({ metadata: { date: "1914", description: ["4a ed., corr. y aum."] } }).edicion, "4.ª ed.");
    assert.equal(manresa.edicionDe({ metadata: { date: "1907" } }).edicion, "");
});

test("Manresa: se elige el ejemplar más antiguo de cada tomo y se indexa", async () => {
    const ff = "\f";
    const djvu = [
        "COMENTARIOS AL CÓDIGO CIVIL",
        "2 CÓDIGO CIVIL\nARTÍCULO 32\nLa personalidad civil se extingue por la muerte de las personas.\nEste artículo reproduce la ley 1, título 5, libro 1 del Digesto.",
        "TÍT. II 3\nsigue el comentario al 32.\nARTÍCULO 33\nSi se duda, entre dos ó más personas…",
        "4 CÓDIGO CIVIL\nsigue el 33.\nARTÍCULO 34\nfin.",
    ].join(ff);
    const pedidas = [];
    globalThis.fetch = async (url) => {
        const u = String(url);
        pedidas.push(u);
        const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
        if (u.includes("advancedsearch.php"))
            return json({
                response: {
                    docs: [
                        { identifier: "BRes0405261", title: "Comentarios al Código Civil español T. 1", date: "1914" },
                        { identifier: "BRes0455341", title: "Comentarios al Código Civil español T. 1", date: "1890" },
                        { identifier: "BRes04553411", title: "Comentarios al Código Civil español T. 11", date: "1905" },
                    ],
                },
            });
        if (u.endsWith("/metadata/BRes0455341"))
            return json({ files: [{ name: "BRes0455341_djvu.txt" }], metadata: { title: "Comentarios al Código Civil español T. 1", date: "1890", publisher: "Madrid : Imprenta de la Revista de Legislación", imagecount: "4" } });
        if (u.endsWith("/download/BRes0455341/BRes0455341_djvu.txt")) return new Response(djvu, { status: 200 });
        return new Response("no", { status: 404 });
    };
    const docs = [
        { identifier: "BRes0405261", title: "Comentarios al Código Civil español T. 1", date: "1914" },
        { identifier: "BRes0455341", title: "Comentarios al Código Civil español T. 1", date: "1890" },
        { identifier: "BRes04553411", title: "Comentarios al Código Civil español T. 11", date: "1905" },
    ];
    const { ident } = await manresa.localizarTomo({ tomo: 1, ident: "BRes0455341" }, docs);
    assert.equal(ident, "BRes0455341");
    await assert.rejects(manresa.localizarTomo({ tomo: 2, ident: "BRes0455342" }, docs), /No se ha encontrado el tomo 2/);

    const res = await manresa.ingest({ log: () => {}, force: true });
    assert.match(res[0], /Manresa, tomo 1: BRes0455341 \(1890, 1\.ª ed\.\), 4 páginas, 3 cabeceras de artículo\./);
    assert.ok(res.slice(1).every((r) => /ERROR|BRes/.test(r)));
    assert.ok(!pedidas.some((u) => u.includes("/metadata/BRes0405261")), "no debe abrir la 4.ª edición si hay una anterior");

    const c = await manresa.comentario(32);
    assert.equal(c.exacto, true);
    assert.match(c.texto, /se extingue por la muerte[\s\S]*sigue el comentario al 32\./);
    assert.doesNotMatch(c.texto, /Si se duda/);
    assert.equal(manresa.urlDe(c.tomo, c.paginas.desde), "https://archive.org/details/BRes0455341/page/n1/mode/1up");
    assert.equal(manresa.describirEdicion(c.tomo), "1.ª ed., Madrid : Imprenta de la Revista de Legislación, 1890");
    await assert.rejects(manresa.comentario(1902), /No se ha localizado el comentario al art\. 1902.*T\. 1: 32–34/);
    const b = await manresa.buscar("personas");
    assert.deepEqual(b.resultados.map((r) => r.articulos), [[32], [33]]);
});
