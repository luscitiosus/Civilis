// Citas de García Goyena: los fragmentos son del OCR real (comentarios a los arts. 18, 107 y 21
// del Proyecto), con sus errores de lectura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extraerCitas, normalizaReferencia, contiene } from "./citas.js";

const refs = (t) => extraerCitas(t).map((c) => c.ref);

test("Digesto y Código de Justiniano, con OCR defectuoso", () => {
    // «ele» por «de», «Digeslo», «lilulo»; «Ley 4 4» y «455» no se aceptan (ilegible / fuera de rango).
    assert.deepEqual(
        refs(
            "Ley 129 ele Verborum significalionc. Partus autem ... Ley 4 4 , título 5, libro 1 del Digesta Y 455 de verborum significatione. Filium natum accipe, ley 12, lilulo 2, libro 28 del Digeslo y 41 de verborum siguí fícaiione",
        ),
        ["D. 50.16.129", "D. 28.2.12"],
    );
    // «leyes 19 y SI'»: se salva el 19.
    assert.deepEqual(refs("vulgo queesitus malrem seqmUir leyes 19 y SI' , título 5, libro 1 del Digesto."), ["D. 1.5.19"]);
    assert.deepEqual(refs("posthumo vero praetérito, ley 2, título 29, libro 6 del Código."), ["C. 6.29.2"]);
    assert.deepEqual(refs("Ley Aquilia, Dig. lib. 9, tít. 2."), ["D. 9.2"]);
    // Cadena con la obra al final; el 18 es un 16 mal leído: D. 50.18 no existe y se descarta.
    assert.deepEqual(refs("leyes 12, título 2, libro 28, y 141 , titulo 18, libro 50 del Digcslo."), ["D. 28.2.12"]);
    assert.deepEqual(refs("leyes 12, título 2, libro 28, y 141, título 16, libro 50 del Digesto."), ["D. 28.2.12", "D. 50.16.141"]);
});

test("Partidas, Toro, fueros y recopilaciones", () => {
    // «vé las o y 5»: la «o» ilegible no impide leer el 5; «título 55» de la Partida 7 no existe.
    assert.deepEqual(refs("vé las o y 5, título 25 , Partida 4 , y 8, título 55, Partida 7."), ["P. 4.25.5"]);
    assert.deepEqual(refs("ley 2, título 15, Partida 4; y leyes 3 y 5, título 23, Partida 4"), ["P. 4.15.2", "P. 4.23.3", "P. 4.23.5"]);
    assert.deepEqual(
        refs("la ley 17, titulo 2, libro 4 del Fuero Juzgo ... y últimamente la 5 de Toro, hoy recopilada 2, título 5, libro 10, por evitar dudas"),
        ["FJ 4.2.17", "Toro 5", "Nov. Rec. 10.5.2"],
    );
    assert.deepEqual(refs("según la ley 6, título 14, libro 1 , Novísima Recopilación , podia ser"), ["Nov. Rec. 1.14.6"]);
    assert.deepEqual(refs("leyes 1 y 2, título 8 , libro 1 de la Novísima Recopilación Navarra."), ["Nov. Rec. Nav. 1.8.1", "Nov. Rec. Nav. 1.8.2"]);
    assert.deepEqual(refs("Las leyes récopiladas 13 y 15, Ululo 1, libro 10 (57 y 59 de Toro), disponían"), ["Nov. Rec. 10.1.13", "Nov. Rec. 10.1.15", "Toro 57", "Toro 59"]);
});

test("no se inventan citas", () => {
    assert.deepEqual(refs("los artículos 9, 10 y 13, título 5, libro 2 del Código civil de Vaud"), []);
    assert.deepEqual(refs("ley 2, título lo, Partida 4"), []); // número ilegible
    assert.deepEqual(refs("según el artículo 1382 del Código francés y el 18 de la Partida"), []);
    assert.deepEqual(refs("en los 12 días, título 5, libro 1 del Digesto"), []); // sin «ley» delante
    assert.deepEqual(refs("ley 3, título 40, libro 2 del Digesto"), []); // D. 2 tiene 15 títulos
});

test("referencias escritas por el usuario", () => {
    assert.deepEqual(normalizaReferencia("D. 1,5,14"), { fuente: "D", ref: "D. 1.5.14" });
    assert.deepEqual(normalizaReferencia("Dig. 9.2"), { fuente: "D", ref: "D. 9.2", parcial: true });
    assert.deepEqual(normalizaReferencia("Partida 4, título 23, ley 5"), { fuente: "P", ref: "P. 4.23.5" });
    assert.deepEqual(normalizaReferencia("4.23.5"), { fuente: "P", ref: "P. 4.23.5" });
    assert.deepEqual(normalizaReferencia("Toro 13"), { fuente: "Toro", ref: "Toro 13" });
    assert.deepEqual(normalizaReferencia("ley 13 de Toro"), { fuente: "Toro", ref: "Toro 13" });
    assert.deepEqual(normalizaReferencia("FJ 4.2.17"), { fuente: "FJ", ref: "FJ 4.2.17" });
    assert.equal(normalizaReferencia("Gai. 1.55"), null);
    assert.ok(contiene("D. 1.5", "D. 1.5.14"));
    assert.ok(!contiene("D. 1.5", "D. 1.50.1"));
    assert.ok(contiene("P. 4.23.5", "P. 4.23.5"));
});
