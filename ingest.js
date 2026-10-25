// Descarga de archive.org el OCR de García Goyena (4 tomos), las Partidas (3) y Manresa (12), y de
// Wikisource el Code civil de 1804; crea data/goyena-*.json, data/partidas-*.json, data/manresa-*.json
// y data/code1804.json. Se ejecuta en la construcción (Render:
// buildCommand). Con --force vuelve a descargar.
import { ingest as ingestGoyena } from "./goyena.js";
import { ingest as ingestPartidas } from "./partidas.js";
import { ingest as ingestCode } from "./codigo1804.js";
import { ingest as ingestManresa } from "./manresa.js";
const force = process.argv.includes("--force");
const resumen = [
    ...(await ingestGoyena({ force })),
    ...(await ingestPartidas({ force })),
    ...(await ingestCode({ force })),
    ...(await ingestManresa({ force })),
];
console.error(resumen.join("\n"));
// No falla la construcción si archive.org no responde: el servidor reintentará al primer uso.
