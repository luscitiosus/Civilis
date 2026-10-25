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
const partidas = await import("./partidas.js");
const code1804 = await import("./codigo1804.js");
const manresa = await import("./manresa.js");

let client;
before(async () => {
    const tomo = {
        tomo: 4,
        ident: "TEST",
        desde: 1564,
        hasta: 1992,
        paginas: [
            "ARTICULO 1900.\nEl que por acción u omisión causa daño a otro, interviniendo culpa o negligencia, está obligado a reparar el daño causado.\n1382 Francés. Ley Aquilia, ley 1, título 2, libro 9 del Digesto; y la ley 6, título 15, Partida 7.",
            "ARTICULO 1901.\nEl dueño de un animal es responsable del daño que este cause.",
        ],
    };
    tomo.articulos = goyena.indexarTomo(tomo.paginas, tomo);
    goyena._setTomos([tomo]);
    partidas._setTomos([
        partidas.prepararTomo({
            tomo: 3,
            ident: "BRes002052",
            partidas: [7],
            paginas: ["PARTIDA VII. 120\nTITULO XV\nDe los daños que los homes facen.\nLEY IV.\nTexto de la cuarta.\nLEY V.\nTexto de la quinta.\nLEY VI.\nCómo debe facer emienda el que fizo daño a otro.\nSi algunt home ficiese daño a otro por su culpa, tenudo es de facer emienda dello."],
        }),
    ]);
    code1804._setDatos({
        formato: 1,
        origen: "Code civil des Français 1804/Texte entier",
        url: "https://fr.wikisource.org/wiki/Code_civil_des_Fran%C3%A7ais_1804/Texte_entier",
        articulos: code1804.analizar(
            "LIVRE III. DES DIFFÉRENTES MANIÈRES DONT ON ACQUIERT LA PROPRIÉTÉ.\nTITRE IV.\nDes engagemens qui se forment sans convention.\nCHAPITRE II.\nDes délits et des quasi-délits.\nArt. 1382. Tout fait quelconque de l'homme, qui cause à autrui un dommage, oblige celui par la faute duquel il est arrivé, à le réparer.\nArt. 1383. Chacun est responsable du dommage qu'il a causé non-seulement par son fait, mais encore par sa négligence ou par son imprudence.",
        ),
    });
    manresa._setTomos([
        {
            tomo: 12,
            ident: "BRes04553412",
            fecha: "1907",
            editorial: "Madrid: Imprenta de la Revista de Legislación",
            edicion: "1.ª ed.",
            paginacion: "hojas",
            paginas: [
                "604 CÓDIGO CIVIL\nARTÍCULO 1902\nEl que por acción ú omisión causa daño á otro, interviniendo culpa ó negligencia, está obligado á reparar el daño causado.\nEste artículo procede de la ley Aquilia; véase la ley 1, título 2, libro 9 del Digesto.",
                "LIB. IV—TÍT. XVI 605\nsigue el comentario sobre la culpa extracontractual.\nARTÍCULO 1903\nLa obligación que impone el artículo anterior es exigible...",
            ],
        },
    ]);
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
        [
            "cc_brocardos", "cc_comparar", "cc_concordancias", "cc_fuente_romana", "cc_historia", "cc_reformas", "cc_version",
            "code_articulo", "code_buscar", "code_para_cc",
            "goyena_articulo", "goyena_buscar", "goyena_citado", "goyena_citas", "goyena_para_cc",
            "historico_buscar", "historico_citar", "manresa_articulo", "manresa_buscar",
        ],
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

test("fuentes citadas por García Goyena y búsqueda inversa", async () => {
    const c = await call("goyena_citas", { numero: 1900 });
    assert.match(c.text, /Digesto \(citar\("…"\)/);
    assert.match(c.text, /– D\. 9\.2\.1  ← «ley 1, título 2, libro 9 del Digesto»/);
    assert.match(c.text, /– P\. 7\.15\.6/);
    const conc1902 = await call("cc_concordancias", { articulo: "1902", goyena: true });
    assert.match(conc1902.text, /FUENTES CITADAS POR GARCÍA GOYENA en el texto y comentario del art\. 1900/);
    const inv = await call("goyena_citado", { cita: "D. 9.2" });
    assert.match(inv.text, /D\. 9\.2\.1 · comentario al art\. 1900 del Proyecto \(T\. 4\) → art\. 1902 CC/);
    const fr = await call("cc_fuente_romana", { cita: "D. 9.2" });
    assert.match(fr.text, /art\. 1902 CC · /);
    assert.match(fr.text, /GARCÍA GOYENA cita D\. 9\.2/);
    assert.match((await call("goyena_citado", { cita: "Toro 13" })).text, /ningún comentario cita Toro 13/);
    assert.equal((await call("goyena_citado", { cita: "lo que sea" })).error, true);
});

test("Partidas: historico_citar e historico_buscar", async () => {
    const l = await call("historico_citar", { referencia: "Partida 7, título 15, ley 6" });
    assert.match(l.text, /PARTIDA VII, TÍTULO XV — De los daños que los homes facen\./);
    assert.match(l.text, /LEY VI \(P\. 7\.15\.6\) — Cómo debe facer emienda/);
    assert.match(l.text, /tenudo es de facer emienda/);
    assert.match(l.text, /CITADA POR GARCÍA GOYENA en el comentario al art\. 1900/);
    assert.match(l.text, /archive\.org\/details\/BRes002052\/page\/n0/);
    const toro = await call("historico_citar", { referencia: "Toro 13" });
    assert.equal(toro.error, true);
    assert.match(toro.text, /Leyes de Toro: el conector todavía no tiene su texto/);
    const b = await call("historico_buscar", { consulta: "emienda" });
    assert.match(b.text, /• P\. 7\.15\.6 ·/);
});

test("Code civil de 1804: code_articulo, code_buscar, code_para_cc", async () => {
    const a = await call("code_articulo", { numero: 1382 });
    assert.equal(a.error, false, a.text);
    assert.match(a.text, /CODE CIVIL \(1804\), art\. 1382/);
    assert.match(a.text, /UBICACIÓN: LIVRE III\. .* › TITRE IV\. Des engagemens qui se forment sans convention\. › CHAPITRE II\. Des délits/);
    assert.match(a.text, /Tout fait quelconque de l'homme/);
    assert.match(a.text, /Proyecto art\. 1900 \(T\. 4\) → art\. 1902 CC/);
    assert.match(a.text, /«1382 Francés»/);
    const b = await call("code_buscar", { consulta: "negligence" });
    assert.match(b.text, /• art\. 1383/);
    const p = await call("code_para_cc", { articulo: "1902" });
    assert.equal(p.error, false, p.text);
    assert.match(p.text, /Proyecto art\. 1900 \(semejanza/);
    assert.match(p.text, /Code art\. 1382 \(TITRE IV\. .*\): Tout fait quelconque/);
    const fuera = await call("code_articulo", { numero: 5 });
    assert.equal(fuera.error, true);
});

test("Manresa: manresa_articulo y manresa_buscar", async () => {
    const m = await call("manresa_articulo", { articulo: "1902" });
    assert.equal(m.error, false, m.text);
    assert.match(m.text, /TOMO: 12 \(BRes04553412\) · 1\.ª ed\., Madrid: Imprenta de la Revista de Legislación, 1907/);
    assert.match(m.text, /COMENTARIO AL ART\. 1902 CC/);
    assert.match(m.text, /sigue el comentario sobre la culpa/);
    assert.doesNotMatch(m.text, /La obligación que impone/);
    assert.match(m.text, /– D\. 9\.2\.1/);
    assert.match(m.text, /archive\.org\/details\/BRes04553412\/page\/n0/);
    const bis = await call("manresa_articulo", { articulo: "94 bis" });
    assert.match(bis.text, /posterior a Manresa/);
    const no = await call("manresa_articulo", { articulo: "1" });
    assert.equal(no.error, true);
    assert.match(no.text, /T\. 12: 1902–1903/);
    const b = await call("manresa_buscar", { consulta: "culpa extracontractual" });
    assert.match(b.text, /comentario al art\. 1902/);
});

test("cc_brocardos y brocardos en cc_concordancias", async () => {
    const r = await call("cc_brocardos", { articulo: "358" });
    assert.match(r.text, /Superficies solo cedit/);
    assert.match(r.text, /Gai\. 2\.73/);
    const q = await call("cc_brocardos", { consulta: "venta quita renta" });
    assert.match(q.text, /Emptio tollit locatum/);
    const f = await call("cc_brocardos", { fuente: "D. 50.17" });
    assert.match(f.text, /Impossibilium nulla obligatio est/);
    const lista = await call("cc_brocardos", {});
    assert.match(lista.text, /Brocardos registrados \(\d+\)/);
    const c = await call("cc_concordancias", { articulo: "116" });
    assert.match(c.text, /BROCARDOS relacionados/);
    assert.match(c.text, /Pater is est quem nuptiae demonstrant/);
    const inv = await call("cc_fuente_romana", { cita: "Gai. 2.73" });
    assert.match(inv.text, /Superficies solo cedit \(Gai\. 2\.73\) → art\. 358 CC/);
});

test("errores claros", async () => {
    const r = await call("cc_historia", { articulo: "abc" });
    assert.equal(r.error, true);
    assert.match(r.text, /no completes con memoria/);
    assert.equal((await call("cc_historia", { articulo: "2500" })).error, true);
    assert.ok(peticiones.every((u) => u.startsWith("https://www.boe.es/")));
});
