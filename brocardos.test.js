import { test } from "node:test";
import assert from "node:assert/strict";
import * as brocardos from "./brocardos.js";

test("brocardos.json: campos completos y valores válidos", () => {
    const ids = new Set();
    for (const b of brocardos.DATOS.brocardos) {
        assert.ok(!ids.has(b.id), `id repetido: ${b.id}`);
        ids.add(b.id);
        for (const k of ["brocardo", "traduccion", "formulacion", "nota"]) assert.ok(b[k], `${b.id}: falta ${k}`);
        assert.ok(["literal", "equivalente", "punto de partida"].includes(b.formulacion), `${b.id}: formulación ${b.formulacion}`);
        assert.ok(b.fuentes.length, `${b.id}: sin fuentes`);
        for (const f of b.fuentes) {
            assert.match(f.cita, /^(D|C|I|Gai)\. \d/, `${b.id}: cita ${f.cita}`);
            assert.ok(f.extracto.split(/\s+/).length <= 30, `${b.id}: extracto demasiado largo`);
        }
        assert.ok(b.articulos.length, `${b.id}: sin artículos`);
        for (const a of b.articulos) {
            assert.match(a.articulo, /^\d{1,4}( bis| ter)?$/, `${b.id}: artículo ${a.articulo}`);
            assert.ok(["antecedente", "contraste", "topico"].includes(a.relacion), `${b.id}: relación ${a.relacion}`);
        }
    }
});

test("brocardos: por artículo, admite párrafos y miles con punto", () => {
    assert.deepEqual(brocardos.porArticulo("358").map((b) => b.id), ["superficies-solo-cedit"]);
    assert.deepEqual(brocardos.porArticulo("7.2").map((b) => b.id), ["qui-suo-iure"]);
    assert.ok(brocardos.porArticulo("art. 1.257").some((b) => b.id === "alteri-stipulari"));
    assert.equal(brocardos.porArticulo("1902").length, 0);
});

test("brocardos: búsqueda por palabras, alias y traducción", () => {
    assert.equal(brocardos.buscar("solo cedit")[0].id, "superficies-solo-cedit");
    assert.equal(brocardos.buscar("mater semper")[0].id, "pater-is-est");
    assert.equal(brocardos.buscar("venta quita renta")[0].id, "emptio-tollit-locatum");
    assert.ok(brocardos.buscar("riesgo comprador").some((b) => b.id === "periculum-emptoris"));
    assert.deepEqual(brocardos.buscar(""), []);
});

test("brocardos: búsqueda inversa por lugar romano", () => {
    assert.ok(brocardos.porFuente("D. 50.17").length >= 6);
    assert.deepEqual(brocardos.porFuente("Gai. 2.73").map((b) => b.id), ["superficies-solo-cedit"]);
    assert.deepEqual(brocardos.porFuente("Dig. 2,4,5").map((b) => b.id), ["pater-is-est"]);
});

test("brocardos: render", () => {
    const t = brocardos.render(brocardos.buscar("superficies")[0]);
    assert.match(t, /Gai\. 2\.73/);
    assert.match(t, /art\. 358 \(antecedente\)/);
});
