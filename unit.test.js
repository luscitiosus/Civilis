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
    // «ARTICLLO 1x01.» cae en el hueco 1900 → 1902: se numera 1901 por la secuencia.
    // «ARTICULO 1450.» está fuera de orden y no hay hueco entre 1902 y 1903: se ignora.
    assert.deepEqual(TOMO.articulos.map((a) => a.n), [1900, 1901, 1902, 1903]);
    assert.equal(TOMO.articulos[1].inferido, true);
    assert.equal(TOMO.articulos[1].leido, "ARTICLLO 1x01.");
    assert.equal(TOMO.articulos[0].inferido, undefined);
    const { texto, paginas } = goyena.textoArticulo(TOMO, 0);
    assert.match(texto, /^ARTICULO 1900\./);
    assert.doesNotMatch(texto, /ARTICLLO 1x01/);
    assert.deepEqual(paginas, { desde: 1, hasta: 2 });
});

test("cabeceras: número ilegible, ordinales y falsos positivos", () => {
    assert.deepEqual(goyena.leerCabecera("ARTICULO lí). "), { ilegible: true, leido: "ARTICULO lí)." });
    assert.deepEqual(goyena.leerCabecera("ARTICLLO 5bl."), { ilegible: true, leido: "ARTICLLO 5bl." });
    assert.deepEqual(goyena.leerCabecera("AUTICULO 21. "), { n: 21 });
    assert.deepEqual(goyena.leerCabecera("ARTÍCULO PRIMERO."), { n: 1 });
    assert.equal(goyena.leerCabecera("ARTICULO ADICIONAL."), null);
    assert.equal(goyena.leerCabecera("ARTICULOS 18 y 21 del Código francés"), null);
    assert.equal(goyena.leerCabecera("Artículo 12."), null);
    assert.deepEqual(goyena.leerCabecera("ARTICULO 19. La calidad de español se pierde"), { n: 19 });
});

// Réplica del tomo 1 tal como sale del OCR real (arts. 18–21, cabecera del 19 ilegible).
const TOMO1 = {
    tomo: 1,
    ident: "BRes0414951",
    desde: 1,
    hasta: 547,
    paginas: [
        "PRÓLOGO\nTexto preliminar del autor sobre el Proyecto.",
        "TITULO PRELIMINAR\nARTICULO !.\nLas leyes obligan en la Península e islas adyacentes en virtud de su promulgación.\nComentario al primero.\nARTICULO 2.\nTexto del segundo.",
        "30 CONCORDANCIAS, MOTIVOS Y COMENTARIOS.\nARTICULO 18.\nSon españoles: Todas las personas nacidas en los dominios de España.\nComentario: Cum legitimae nuptiae factae sint, patrem liberi sequuntur.",
        // El OCR real del art. 19 se corta en «…de otro Gobierno sin»; el final es de prueba.
        "DEL CÓDIGO CIVIL ESPAÑOL. • 51\ncontinúa el comentario al 18.\nARTICULO lí).\nLa calidad de español se pierde, por adquirir naturaleza en país estranjero y por admitir empleo de otro Gobierno sin licencia del Rey, ó entrar al servicio de las armas de una potencia estranjera.",
        "32 CONCORDANCIAS, MOTIVOS Y COMENTARIOS.\nARTÍCULO 20.\nEl español que hubiere perdido esta calidad por adquirir naturaleza en pais estranjero, podrá recobrarla volviendo al reino.",
        "DEL CÓDIGO CIVIL ESPAÑOL. 33\nAUTICULO 21.\nEl español que hubiere perdido esta calidad por admitir empleo de otro Gobierno, ó entrar al servicio de las armas de una potencia estranjera sin licencia del Rey, no podrá recobrarla sin obtener previamente la Real habilitación.",
    ],
};
TOMO1.etiquetas = goyena.etiquetasImpresas(TOMO1.paginas);
TOMO1.articulos = goyena.indexarTomo(TOMO1.paginas, TOMO1);

test("tomo 1: se recuperan el art. 1 y el art. 19 por la secuencia", async () => {
    assert.deepEqual(TOMO1.articulos.map((a) => a.n), [1, 2, 18, 19, 20, 21]);
    assert.deepEqual(TOMO1.articulos.filter((a) => a.inferido).map((a) => a.n), [1, 19]);
    goyena._setTomos([TOMO1]);
    goyena._resetIndice();
    const uno = await goyena.articuloProyecto(1);
    assert.equal(uno.exacto, true);
    assert.equal(uno.inferido, true);
    // El art. 20 del CC de 1889 (pérdida de la nacionalidad) corresponde al 19 del Proyecto.
    const c = await goyena.candidatosParaTexto(
        "Artículo 20.\nLa calidad de español se pierde por adquirir naturaleza en país extranjero, o por admitir empleo de otro Gobierno, o entrar al servicio de las armas de una potencia extranjera sin licencia del Rey.",
    );
    assert.equal(c[0].n, 19);
    assert.equal(c[0].inferido, true);
    assert.match(c[0].url, /BRes0414951\/page\/n3\/mode/); // 4.ª hoja → n3
    assert.match(c[0].paginaTexto, /págs\. 4–5 del escaneo \(impresas 31–32\)/);
});

test("tomo sin cabecera para los primeros artículos: se muestra el texto previo", async () => {
    const t = {
        tomo: 1,
        ident: "X",
        desde: 1,
        hasta: 547,
        paginas: ["PRÓLOGO", "Las leyes obligan en la Península.\nARTICULO 5.\nTexto del quinto.", "ARTICULO 6.\nTexto del sexto."],
    };
    t.articulos = goyena.indexarTomo(t.paginas, t);
    assert.deepEqual(t.articulos.map((a) => a.n), [5, 6]);
    goyena._setTomos([t]);
    const r = await goyena.articuloProyecto(1);
    assert.equal(r.antesDe, 5);
    const { texto, paginas } = goyena.textoAntesDelPrimero(t, 2000);
    assert.match(texto, /Las leyes obligan/);
    assert.doesNotMatch(texto, /ARTICULO 5/);
    assert.equal(paginas.hasta, 2);
});

test("paginación: hOCR (caracteres o bytes), djvu.xml y cabeceras impresas", () => {
    const txt = "Página uno ñ\nPágina dos\n";
    const buf = Buffer.from(txt, "utf-8");
    // Desplazamientos en caracteres
    assert.deepEqual(goyena.paginasDesdeHocr(buf, [[0, 13], [13, 24]]), ["Página uno ñ\n", "Página dos\n"]);
    // Desplazamientos en bytes («á» y «ñ» ocupan dos)
    const b1 = Buffer.byteLength("Página uno ñ\n");
    assert.deepEqual(goyena.paginasDesdeHocr(buf, [[0, b1], [b1, buf.length]]), ["Página uno ñ\n", "Página dos\n"]);

    const xml =
        '<?xml version="1.0"?><DjVuXML><BODY>' +
        '<OBJECT data="a"><HIDDENTEXT><PAGECOLUMN><REGION><PARAGRAPH><LINE><WORD coords="1">ARTICULO</WORD><WORD coords="2">20.</WORD></LINE>' +
        '<LINE><WORD coords="3">El</WORD><WORD coords="4">espa&#241;ol</WORD><WORD>&amp;c.</WORD></LINE></PARAGRAPH></REGION></PAGECOLUMN></HIDDENTEXT></OBJECT>' +
        '<OBJECT data="b"><HIDDENTEXT><LINE><WORD>Segunda</WORD></LINE></HIDDENTEXT></OBJECT></BODY></DjVuXML>';
    const px = goyena.paginasDesdeDjvuXml(xml);
    assert.equal(px.length, 2);
    assert.equal(px[0].split("\n")[0], "ARTICULO 20.");
    assert.match(px[0], /El español &c\./);
    assert.match(px[1], /Segunda/);

    const sinFf = "Fin del prólogo.\n30 CONCORDANCIAS, MOTIVOS Y COMENTARIOS.\nuno\nDEL CÓDIGO CIVIL ESPAÑOL. • 51\ndos\n32. CONCORnANCIAS , MOTIVOS Y COMENTARIOS\ntres";
    const pc = goyena.paginasPorCabeceras(sinFf);
    assert.equal(pc.length, 4);
    // «• 51» es un 31 mal leído: no concuerda con sus vecinas y se deduce por la secuencia.
    assert.deepEqual(goyena.etiquetasImpresas(pc), [29, 30, 31, 32]);
    const t = { ident: "Y", paginacion: "impresas", etiquetas: [29, 30, 31, 32] };
    assert.equal(goyena.urlPagina(t, 3), "https://archive.org/details/Y/page/31/mode/1up");
    assert.equal(goyena.describirPaginas(t, 2, 3), "págs. impresas 30–31");
    assert.equal(goyena.describirPaginas(t, 3, 3), "pág. impresa 31");
    assert.equal(goyena.describirPaginas({ etiquetas: [7] }, 1, 1), "pág. 1 del escaneo (impresa 7)");
    assert.equal(goyena.urlPagina("Y", 3), "https://archive.org/details/Y/page/n2/mode/1up");
});

test("semejanza textual entre el art. 1902 CC y el Proyecto", async () => {
    goyena._setTomos([TOMO]);
    goyena._resetIndice();
    const c = await goyena.candidatosParaTexto(
        "Artículo 1902.\nEl que por acción u omisión causa daño a otro, interviniendo culpa o negligencia, está obligado a reparar el daño causado.",
    );
    assert.equal(c[0].n, 1900);
    // La ventana ya no se mezcla con el art. 1901 (antes inflaba la cifra a 0,41).
    assert.ok(c[0].puntuacion > 0.3);
    const r = await goyena.buscar("ley aquilia");
    assert.equal(r.total, 1);
    assert.equal(r.resultados[0].articulo, 1900);
    const deducido = await goyena.articuloProyecto(1901);
    assert.equal(deducido.exacto, true);
    assert.equal(deducido.inferido, true);
    // Sin cabecera en el OCR (1904 en adelante): se da el tramo del último reconocido.
    const ilegible = await goyena.articuloProyecto(1950);
    assert.equal(ilegible.exacto, false);
    assert.equal(ilegible.tomo.articulos[ilegible.idx].n, 1903);
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
