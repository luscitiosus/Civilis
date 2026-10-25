import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FJ_MIN_INTERVAL_MS = "0";
process.env.CC_DATA_DIR = mkdtempSync(join(tmpdir(), "code1804-"));
const code = await import("./codigo1804.js");

const TEXTO = [
    "TITRE PRÉLIMINAIRE.",
    "DE LA PUBLICATION, DES EFFETS ET DE L'APPLICATION DES LOIS EN GÉNÉRAL.",
    "Article premier. Les lois sont exécutoires dans tout le territoire français.",
    "Elles seront exécutées dans chaque partie de la République.",
    "Art. 2. La loi ne dispose que pour l'avenir; elle n'a point d'effet rétroactif.",
    "LIVRE PREMIER. DES PERSONNES.",
    "TITRE PREMIER.",
    "De la jouissance et de la privation des droits civils.",
    "Art. 3. Les lois de police et de sûreté obligent tous ceux qui habitent le territoire.",
    "1. Les immeubles, même ceux possédés par des étrangers, sont régis par la loi française.",
    "Art. 4. Le juge qui refusera de juger…",
    "Art. 5. Il est défendu aux juges de prononcer par voie de disposition générale.",
].join("\n");

test("Code 1804: cabeceras de artículo", () => {
    assert.deepEqual(code.leerArticulo("Art. 552. La propriété du sol emporte la propriété du dessus et du dessous."), { n: 552, resto: "La propriété du sol emporte la propriété du dessus et du dessous." });
    assert.equal(code.leerArticulo("Article premier. Les lois…").n, 1);
    assert.equal(code.leerArticulo("Art. 1er. Les lois…").n, 1);
    assert.equal(code.leerArticulo("ART. 720 — Si plusieurs personnes…").n, 720);
    assert.equal(code.leerArticulo("721. Si ceux qui ont péri ensemble…").desnudo, true);
    assert.equal(code.leerArticulo("1° les biens"), null);
    assert.equal(code.leerArticulo("LIVRE II."), null);
});

test("Code 1804: análisis con divisiones y enumeraciones internas", () => {
    const as = code.analizar(TEXTO);
    assert.deepEqual(as.map((a) => a.n), [1, 2, 3, 4, 5]);
    assert.match(as[0].texto, /exécutoires[\s\S]*chaque partie de la République/);
    assert.equal(as[0].contexto.titre, "TITRE PRÉLIMINAIRE. DE LA PUBLICATION, DES EFFETS ET DE L'APPLICATION DES LOIS EN GÉNÉRAL.");
    assert.equal(as[2].contexto.livre, "LIVRE PREMIER. DES PERSONNES.");
    assert.equal(as[2].contexto.titre, "TITRE PREMIER. De la jouissance et de la privation des droits civils.");
    // «1. Les immeubles…» es un párrafo del art. 3, no el art. 1.
    assert.match(as[2].texto, /1\. Les immeubles/);
    assert.equal(code.describirContexto(as[2].contexto), "LIVRE PREMIER. DES PERSONNES. › TITRE PREMIER. De la jouissance et de la privation des droits civils.");
});

test("Code 1804: un salto grande sin «Art.» no se acepta", () => {
    const as = code.analizar("Art. 10. Texto.\n2000. Une année entière.\nArt. 11. Texto.");
    assert.deepEqual(as.map((a) => a.n), [10, 11]);
});

test("Code 1804: remisiones de García Goyena al Code", () => {
    const r = code.citasFrancesas("El artículo ha sido tomado de los 319 y 320 Franceses, 212 y 213 de la Luisiana, 241 y 242 Napolitanos");
    assert.deepEqual(r.map((x) => x.n), [319, 320]);
    assert.equal(r[0].original, "319 y 320 Franceses");
    assert.deepEqual(code.citasFrancesas("Es el 6 FranceSj 7 Napolitano").map((x) => x.n), [6]);
    assert.deepEqual(code.citasFrancesas("artículos 552 al 555 del Código francés").map((x) => x.n), [552, 553, 554, 555]);
    assert.deepEqual(code.citasFrancesas("1382 Francés. Ley Aquilia").map((x) => x.n), [1382]);
    assert.deepEqual(code.citasFrancesas("véase el artículo 98, y el Francés"), []);
    assert.deepEqual(code.citasFrancesas("según el Código civil francés, la propiedad"), []);
    assert.deepEqual(code.citasFrancesas("el 9999 Francés"), []);
});

test("Code 1804: descarga de Wikisource, con paso a las subpáginas si «Texte entier» falla", async () => {
    const pedidas = [];
    globalThis.fetch = async (url) => {
        const u = new URL(String(url));
        pedidas.push(u.searchParams.get("page"));
        const page = u.searchParams.get("page");
        const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
        if (page.endsWith("/Texte entier")) return json({ error: { code: "missingtitle", info: "The page you specified doesn't exist." } });
        if (u.searchParams.get("prop") === "links")
            return json({ parse: { links: [{ title: "Code civil des Français 1804/Titre préliminaire" }, { title: "Code civil des Français 1804/Livre I, Titre I" }, { title: "Auteur:Napoléon" }] } });
        if (page.endsWith("/Titre préliminaire"))
            return json({ parse: { text: '<div class="ws-noexport">Navigation</div><h3>TITRE PRÉLIMINAIRE.</h3><p><b>Article premier.</b> Les lois sont exécutoires.<sup class="reference">[1]</sup></p><p><b>Art. 2.</b> La loi ne dispose que pour l\'avenir.</p>' } });
        if (page.endsWith("/Livre I, Titre I")) return json({ parse: { text: "<h2>LIVRE PREMIER.</h2><h3>TITRE PREMIER.</h3><p>De la jouissance des droits civils.</p><p><b>Art. 7.</b> L'exercice des droits civils est indépendant de la qualité de citoyen.</p>" } });
        return new Response("no", { status: 404 });
    };
    const res = await code.ingest({ log: () => {}, force: true });
    assert.match(res[0], /Code 1804: 3 artículos reconocidos de 2281 \(Code civil des Français 1804 \(2 subpáginas\)\); faltan 2278/);
    assert.ok(!pedidas.includes("Auteur:Napoléon"));
    code._setDatos(undefined);
    const a = await code.articulo(7);
    assert.match(a.texto, /^L'exercice des droits civils/);
    assert.equal(a.contexto.titre, "TITRE PREMIER. De la jouissance des droits civils.");
    const uno = await code.articulo(1);
    assert.doesNotMatch(uno.texto, /\[1\]|Navigation/);
    await assert.rejects(code.articulo(5), /No se ha reconocido el art\. 5 del Code.*code_articulo\(2\)/);
    await assert.rejects(code.articulo(3000), /fuera de rango/);
    assert.equal((await code.buscar("avenir")).resultados[0].n, 2);
});
