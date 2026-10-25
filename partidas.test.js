// Partidas (edición de 1807): cabeceras con números romanos y OCR defectuoso.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as partidas from "./partidas.js";

test("números romanos y cabeceras", () => {
    assert.equal(partidas.romano("XXIII"), 23);
    assert.equal(partidas.romano("ii."), 2);
    assert.equal(partidas.romano("l1"), 2); // l y 1 por I
    assert.equal(partidas.romano("IIII"), null);
    assert.equal(partidas.romano("VX"), null);
    assert.equal(partidas.aRomano(34), "XXXIV");

    assert.deepEqual(partidas.leerTitulo("TITULO XXIII"), { n: 23, resto: "" });
    assert.deepEqual(partidas.leerTitulo("TITULO II. De los casamientos."), { n: 2, resto: "De los casamientos." });
    assert.equal(partidas.leerTitulo("titulo iii del fuero"), null); // minúsculas: cita, no cabecera
    assert.deepEqual(partidas.leerLey("LEY V."), { n: 5, resto: "" });
    assert.deepEqual(partidas.leerLey("ley ii."), { n: 2, resto: "" });
    assert.equal(partidas.leerLey("ley iii del titulo sobredicho dice"), null);
    assert.equal(partidas.leerPartida("3 PARTIDA IV."), 4);
    assert.equal(partidas.leerPartida("PARTIDA IV. 17"), 4);
    assert.equal(partidas.leerPartida("PARTIDA QUARTA"), 4);
    assert.equal(partidas.leerPartida("la partida iv dice"), null);
});

// Tomo 3 en miniatura: Partida IV (títulos I y II) y Partida V sin cabecera de página legible.
const T3 = {
    tomo: 3,
    ident: "BRes002052",
    partidas: [4, 5, 6, 7],
    paginas: [
        "PARTIDA QUARTA.\nTITULO I\nDe los desposorios.\nLEY I.\nQué cosa es desposorio, et onde tomó este nombre.\nLlamado es desposorio el prometimiento que facen los homes por palabra quando quieren casarse.\nLEY II.\nEn quántas maneras se facen los desposorios.",
        "2 PARTIDA IV.\nLEY III.\nDe qué edat deben seer los que se desposan.\nTexto de la ley tercera, segunt dice la ley iii del titulo sobredicho.\nLEY V.\nTexto de la quinta (la cuarta tiene la cabecera ilegible).",
        "PARTIDA IV. 3\nTITULO II\nDe los casamientos.\nLEY I.\nQué cosa es casamiento.\nMatrimonio es ayuntamiento de marido et de muger.\nley ii.\nTexto de la segunda.",
        "TITULO I\nDe los contratos de los empréstidos.\nLEY I.\nQué cosa es empréstido.\nEmpréstido es una manera de pleyto que facen los homes.",
    ],
};
partidas.prepararTomo(T3);

test("índice del tomo: títulos, leyes y cambio de Partida sin cabecera", () => {
    assert.deepEqual(
        T3.titulos.map((x) => `${x.p}.${x.t}`),
        ["4.1", "4.2", "5.1"],
    );
    assert.deepEqual(
        T3.leyes.map((x) => `${x.p}.${x.t}.${x.l}`),
        ["4.1.1", "4.1.2", "4.1.3", "4.1.5", "4.2.1", "4.2.2", "5.1.1"],
    );
    assert.equal(T3.titulos[0].rubrica, "De los desposorios.");
    assert.equal(T3.leyes[0].rubrica, "Qué cosa es desposorio, et onde tomó este nombre.");
});

test("lectura de leyes y búsqueda", async () => {
    partidas._setTomos([T3]);
    const r = await partidas.ley(4, 1, 1);
    assert.equal(r.exacto, true);
    assert.match(r.texto, /^LEY I\.\nQué cosa es desposorio/);
    assert.doesNotMatch(r.texto, /LEY II/);
    assert.equal(r.url, "https://archive.org/details/BRes002052/page/n0/mode/1up");

    const cuarta = await partidas.ley(4, 1, 4); // cabecera ilegible: tramo de la III
    assert.equal(cuarta.exacto, false);
    assert.equal(cuarta.entrada.l, 3);

    const quinta = await partidas.ley(5, 1, 1);
    assert.match(quinta.texto, /Empréstido es una manera/);
    await assert.rejects(partidas.ley(6, 1, 1), /no se ha localizado el título 1 de la Partida 6/i);
    await assert.rejects(partidas.ley(8, 1, 1), /siete/);

    const b = await partidas.buscar("ayuntamiento de marido");
    assert.equal(b.total, 1);
    assert.deepEqual([b.resultados[0].donde.p, b.resultados[0].donde.t, b.resultados[0].donde.l], [4, 2, 1]);
    assert.equal((await partidas.buscar("empréstido", { partida: 4 })).total, 0);
});

test("una tabla de títulos al principio de la Partida no bloquea el texto", () => {
    const t = partidas.prepararTomo({
        tomo: 1,
        ident: "X",
        partidas: [1],
        paginas: [
            "INDICE\nTITULO I\nDe las leyes.\nTITULO II\nDel uso.\nTITULO III\nDe la costumbre.",
            "TITULO I\nDe las leyes.\nLEY I.\nQué cosa es ley.\nLEY II.\nTexto.\nTITULO II\nDel uso.\nLEY I.\nTexto.",
        ],
    });
    assert.deepEqual(t.titulos.map((x) => `${x.t}@${x.pagina}`), ["1@2", "2@2"]);
    assert.deepEqual(t.leyes.map((x) => `${x.t}.${x.l}`), ["1.1", "1.2", "2.1"]);
});
