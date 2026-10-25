import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as boe from "./boe.js";
import { renderDiff } from "./diff.js";
import * as goyena from "./goyena.js";
import * as conc from "./concordancias.js";

const fx = (f) => readFileSync(new URL(`./fixture-${f}`, import.meta.url), "utf-8");
const indice = boe.parseIndice(JSON.parse(fx("indice.json")));

test("títulos irregulares del índice del BOE", () => {
    assert.deepEqual(boe.parseTituloArticulo("Art 32"), { desde: 32, hasta: 32, sufijo: "", rango: false });
    assert.deepEqual(boe.parseTituloArticulo("Art. 958 bis"), { desde: 958, hasta: 958, sufijo: "bis", rango: false });
    assert.deepEqual(boe.parseTituloArticulo("Arts 127 a 130"), { desde: 127, hasta: 130, sufijo: "", rango: true });
    assert.deepEqual(boe.parseTituloArticulo("Art. 1231 A 1253"), { desde: 1231, hasta: 1253, sufijo: "", rango: true });
    assert.deepEqual(boe.parseTituloArticulo("Arts 307 al 313"), { desde: 307, hasta: 313, sufijo: "", rango: true });
    assert.equal(boe.parseTituloArticulo("CAPÍTULO II"), null);
    assert.equal(boe.parseTituloArticulo("Sección 1ª"), null);
});

test("localiza artículos en el índice real del Código Civil", () => {
    assert.equal(boe.localizar(indice, "1902").bloque.id, "art1902");
    assert.equal(boe.localizar(indice, "art. 1.902").bloque.id, "art1902");
    assert.equal(boe.localizar(indice, "1").bloque.id, "a1");
    // id irregular: el bloque del 94 bis se llama "a9"
    assert.equal(boe.localizar(indice, "94 bis").bloque.id, "a9");
    assert.equal(boe.localizar(indice, "94").bloque.id !== "a9", true);
    // si el artículo tiene bloque propio se prefiere al agrupado ("Arts 127 a 130" + "Art 128")
    assert.equal(boe.localizar(indice, "128").bloque.id, "a128");
    // los 1976 artículos tienen bloque propio en el índice real
    for (let n = 1; n <= 1976; n++) {
        const l = boe.localizar(indice, String(n));
        assert.ok(l && !l.agrupado, `art. ${n}`);
    }
    // si solo existiera el bloque agrupado, se usa ese
    const g = boe.localizar([{ id: "x", titulo: "Art. 1231 A 1253" }], "1240");
    assert.equal(g.bloque.id, "x");
    assert.equal(g.agrupado, true);
    assert.equal(boe.localizar(indice, "1863 bis").bloque.id, "art.1863bis");
    assert.equal(boe.localizar(indice, "1977"), null);
    // cuántos artículos distintos reconoce del índice real
    const n = indice.filter((b) => boe.parseTituloArticulo(b.titulo)).length;
    assert.ok(n > 1990, `solo ${n} bloques de artículo`);
});

test("versiones, notas y normas modificadoras", () => {
    const [b] = boe.parseBloquesXml(fx("art154.xml"));
    assert.equal(b.versiones.length, 4);
    assert.match(b.versiones[0].texto, /^Artículo 154\.\nEl padre, y en su defecto la madre/);
    assert.equal(b.versiones[1].notas.length, 1);
    assert.doesNotMatch(b.versiones[1].texto, /Se modifica/);
    const nombres = boe.nombresDeNormas(b.versiones);
    assert.equal(nombres.get("BOE-A-1981-11198"), "Ley 11/1981, de 13 de mayo");
    assert.equal(nombres.get("BOE-A-2005-11364"), "Ley 13/2005, de 1 de julio");
    assert.equal(nombres.get("BOE-A-2021-9347"), "Ley Orgánica 8/2021, de 4 de junio");
    assert.equal(boe.describirNorma("BOE-A-1889-4763", nombres), "redacción original (Real Decreto de 24 de julio de 1889)");
});

test("selección de versión por fecha, número y alias", () => {
    const [b] = boe.parseBloquesXml(fx("art154.xml"));
    const v = b.versiones;
    assert.equal(boe.seleccionarVersion(v, "original"), 0);
    assert.equal(boe.seleccionarVersion(v, "vigente"), 3);
    assert.equal(boe.seleccionarVersion(v, "2"), 1);
    assert.equal(boe.seleccionarVersion(v, "1990-01-01"), 1);
    assert.equal(boe.seleccionarVersion(v, "2005-07-03"), 2); // el día de entrada en vigor
    assert.equal(boe.seleccionarVersion(v, "2005-07-02"), 1);
    assert.equal(boe.seleccionarVersion(v, "1880-01-01"), -1);
    assert.throws(() => boe.seleccionarVersion(v, "9"));
    assert.throws(() => boe.seleccionarVersion(v, "ayer"));
});

test("comparación palabra a palabra", () => {
    const d = renderDiff("Los hijos no emancipados están bajo la potestad del padre y de la madre.", "Los hijos no emancipados están bajo la potestad de sus progenitores.");
    assert.equal(d.texto, "Los hijos no emancipados están bajo la potestad [-del padre y de la madre.-] {+de sus progenitores.+}");
    assert.equal(renderDiff("igual", "igual").iguales, true);
    const e = renderDiff("uno dos tres", "uno tres");
    assert.equal(e.texto, "uno [-dos-] tres");
    const f = renderDiff("a\nb", "a\nb\nc");
    assert.equal(f.texto, "a\nb\n{+c+}");
});

test("cabeceras OCR de García Goyena", () => {
    assert.equal(goyena.cabeceraArticulo("ARTICULO 569."), 569);
    assert.equal(goyena.cabeceraArticulo("ARTÍCULO 12."), 12);
    assert.equal(goyena.cabeceraArticulo("AUTIGüLO 554.:"), 554);
    assert.equal(goyena.cabeceraArticulo("ARTICLLO 5bl."), null); // cifras ilegibles
    assert.equal(goyena.cabeceraArticulo("ARTICULO l9."), 19); // l → 1
    assert.equal(goyena.cabeceraArticulo("Artículo 12. del Código francés"), null); // minúsculas: cita, no cabecera
    assert.equal(goyena.cabeceraArticulo("CONCORDANCIAS, MOTIVOS"), null);
});

const TOMO = {
    tomo: 4,
    ident: "TEST",
    desde: 1564,
    hasta: 1992,
    paginas: [
        "DEL CÓDIGO CIVIL ESPAÑOL. 7\nARTICULO 1900.\nEl que ejecuta un hecho en que interviene algún género de culpa o negligencia, aunque no constituya delito, está obligado a la reparación del perjuicio causado a otro.\n1382 Francés. Ley Aquilia, Dig. lib. 9, tít. 2.",
        "8 CONCORDANCIAS, MOTIVOS Y COMENTARIOS\ncomentario que sigue.\nARTICLLO 1x01.\nEl dueño de un animal es responsable del daño que este cause.\nARTICULO 1902.\nLa obligación de reparar el daño causado se extiende a los padres por los hechos de sus hijos.",
        "ARTICULO 1450.\nnúmero fuera de orden (debe ignorarse)\nARTICULO 1903.\nTexto del 1903.",
    ],
};
TOMO.articulos = goyena.indexarTomo(TOMO.paginas, TOMO);

test("índice de artículos del Proyecto con OCR defectuoso", () => {
    assert.deepEqual(TOMO.articulos.map((a) => a.n), [1900, 1902, 1903]);
    const { texto, paginas } = goyena.textoArticulo(TOMO, 0);
    assert.match(texto, /^ARTICULO 1900\./);
    assert.match(texto, /comentario que sigue/);
    assert.doesNotMatch(texto, /ARTICULO 1902/);
    assert.deepEqual(paginas, { desde: 1, hasta: 2 });
});

test("semejanza textual entre el art. 1902 CC y el Proyecto", async () => {
    goyena._setTomos([TOMO]);
    goyena._resetIndice();
    const c = await goyena.candidatosParaTexto(
        "Artículo 1902.\nEl que por acción u omisión causa daño a otro, interviniendo culpa o negligencia, está obligado a reparar el daño causado.",
    );
    assert.equal(c[0].n, 1900);
    assert.ok(c[0].puntuacion > 0.4);
    const r = await goyena.buscar("ley aquilia");
    assert.equal(r.total, 1);
    assert.equal(r.resultados[0].articulo, 1900);
    const ilegible = await goyena.articuloProyecto(1901);
    assert.equal(ilegible.exacto, false);
    assert.equal(ilegible.tomo.articulos[ilegible.idx].n, 1900);
});

test("concordancias: datos, búsqueda directa e inversa", () => {
    const es = conc.DATOS.entradas;
    assert.ok(es.length >= 60);
    for (const e of es) {
        assert.ok(["antecedente", "contraste", "topico"].includes(e.relacion), e.articulo);
        assert.ok(e.fuentes.length && e.nota && e.materia, e.articulo);
        assert.doesNotThrow(() => boe.normalizaArticulo(e.articulo));
        for (const f of e.fuentes) assert.match(f.cita, /^(D|I|C|Gai)\. \d/, f.cita);
    }
    assert.equal(conc.porArticulo("art. 1.902")[0].fuentes[0].cita, "D. 9.2.1 pr.");
    assert.deepEqual(conc.porArticulo("1"), []);
    assert.deepEqual(conc.porFuente("D. 9.2").map((r) => r.entrada.articulo), ["1902"]);
    assert.deepEqual(conc.porFuente("Dig. 9,2,1 pr").map((r) => r.entrada.articulo), ["1902"]);
    assert.deepEqual(new Set(conc.porFuente("I. 2.6").map((r) => r.entrada.articulo)), new Set(["1955", "1957"]));
    assert.ok(conc.porFuente("Gai. 3").some((r) => r.entrada.articulo === "1089"));
    assert.equal(conc.porFuente("D. 9.20").length, 0);
    assert.ok(conc.porTexto("usufructo").some((e) => e.articulo === "467"));
});
