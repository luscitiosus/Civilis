// Prueba de extremo a extremo: cliente MCP ↔ servidor, con las respuestas del BOE simuladas
// a partir de datos reales (índice completo del Código Civil y bloques del art. 154 y 1902).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.CC_GOYENA_AUTOINGEST = "0";
process.env.FJ_MIN_INTERVAL_MS = "0";
const fx = (f) => readFileSync(new URL(`./fixture-${f}`, import.meta.url), "utf-8");
const peticiones = [];

globalThis.fetch = async (url) => {
    const u = String(url);
    peticiones.push(u);
    const base = "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-1889-4763";
    const mapa = {
        [`${base}/texto/indice`]: ["indice.json", "application/json"],
        [`${base}/texto/bloque/art154`]: ["art154.xml", "application/xml"],
        [`${base}/texto/bloque/art1902`]: ["art1902.xml", "application/xml"],
        [`${base}/texto`]: ["completo.xml", "application/xml"],
    };
    const hit = mapa[u];
    if (!hit) return new Response("no encontrado", { status: 404 });
    return new Response(fx(hit[0]), { status: 200, headers: { "Content-Type": hit[1] } });
};

const { createServer } = await import("./server.js");
const goyena = await import("./goyena.js");

let client;
before(async () => {
    const tomo = {
        tomo: 4,
        ident: "TEST",
        desde: 1564,
        hasta: 1992,
        paginas: [
            "ARTICULO 1900.\nEl que ejecuta un hecho en que interviene algún género de culpa o negligencia, aunque no constituya delito, está obligado a la reparación del perjuicio causado a otro.\n1382 Francés. Ley Aquilia.",
            "ARTICULO 1901.\nEl dueño de un animal es responsable del daño que este cause.",
        ],
    };
    tomo.articulos = goyena.indexarTomo(tomo.paginas, tomo);
    goyena._setTomos([tomo]);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer().connect(a);
    client = new Client({ name: "test", version: "1" });
    await client.connect(b);
});

const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: Boolean(r.isError), text: r.content.map((c) => c.text).join("\n") };
};

test("lista de herramientas", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(
        tools.map((t) => t.name).sort(),
        ["cc_comparar", "cc_concordancias", "cc_fuente_romana", "cc_historia", "cc_reformas", "cc_version", "goyena_articulo", "goyena_buscar", "goyena_para_cc"],
    );
});

test("cc_historia", async () => {
    const r = await call("cc_historia", { articulo: "154" });
    assert.equal(r.error, false, r.text);
    assert.match(r.text, /CRONOLOGÍA \(4 versiones\)/);
    assert.match(r.text, /1\/4 · vigente desde 16\/08\/1889 · redacción original/);
    assert.match(r.text, /2\/4 · vigente desde 08\/06\/1981 · Ley 11\/1981, de 13 de mayo \(BOE-A-1981-11198\)/);
    assert.match(r.text, /4\/4 · vigente desde 25\/06\/2021 · Ley Orgánica 8\/2021, de 4 de junio/);
    assert.match(r.text, /URL OFICIAL: https:\/\/www\.boe\.es\/buscar\/act\.php\?id=BOE-A-1889-4763#art154/);
    const solo = await call("cc_historia", { articulo: "154", textos: false });
    assert.doesNotMatch(solo.text, /TEXTOS LITERALES/);
});

test("cc_version por fecha y fuera de rango", async () => {
    const r = await call("cc_version", { articulo: "art. 154", version: "1995-03-01" });
    assert.match(r.text, /VERSIÓN: 2\/4/);
    assert.match(r.text, /VIGENCIA: del 08\/06\/1981 al día anterior al 03\/07\/2005/);
    assert.match(r.text, /bajo la potestad del padre y de la madre/);
    const antes = await call("cc_version", { articulo: "154", version: "1850-01-01" });
    assert.match(antes.text, /no existía el 1850-01-01/);
});

test("cc_comparar", async () => {
    const r = await call("cc_comparar", { articulo: "154", desde: "2", hasta: "3" });
    assert.match(r.text, /\[-del padre y de la madre\.-\] \{\+de sus progenitores\.\+\}/);
    assert.match(r.text, /Ley 13\/2005/);
    const una = await call("cc_comparar", { articulo: "1902" });
    assert.match(una.text, /conserva su redacción original de 1889/);
});

test("cc_reformas", async () => {
    const r = await call("cc_reformas", { norma: "Ley 13/2005" });
    assert.equal(r.error, false, r.text);
    assert.match(r.text, /Ley 13\/2005, de 1 de julio \(BOE-A-2005-11364\) — vigente desde 03\/07\/2005/);
    assert.match(r.text, /art\. 154/);
    const todas = await call("cc_reformas", { desde: "2000-01-01" });
    assert.match(todas.text, /: 2\n/);
    const nada = await call("cc_reformas", { norma: "Ley 99/1999" });
    assert.equal(nada.error, true);
});

test("cc_concordancias con García Goyena", async () => {
    const r = await call("cc_concordancias", { articulo: "1902", goyena: true });
    assert.match(r.text, /D\. 9\.2\.1 pr\./);
    assert.match(r.text, /Proyecto art\. 1900 \(T\. 4/);
    const sin = await call("cc_concordancias", { articulo: "154 bis" });
    assert.match(sin.text, /No hay concordancias romanas registradas/);
    const lista = await call("cc_concordancias", {});
    assert.match(lista.text, /art\. 467 · Usufructo/);
});

test("cc_fuente_romana, goyena_articulo, goyena_buscar", async () => {
    assert.match((await call("cc_fuente_romana", { cita: "D. 9.2" })).text, /art\. 1902 CC/);
    const g = await call("goyena_articulo", { numero: 1901 });
    assert.match(g.text, /PROYECTO DE 1851: art\. 1901/);
    assert.match(g.text, /archive\.org\/details\/TEST\/page\/n1/);
    assert.match((await call("goyena_buscar", { consulta: "Aquilia" })).text, /comentario al art\. 1900/);
});

test("errores claros", async () => {
    const r = await call("cc_historia", { articulo: "abc" });
    assert.equal(r.error, true);
    assert.match(r.text, /no completes con memoria/);
    assert.equal((await call("cc_historia", { articulo: "2500" })).error, true);
    assert.ok(peticiones.every((u) => u.startsWith("https://www.boe.es/")));
});
