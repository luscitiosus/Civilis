// Descarga de archive.org el OCR de los cuatro tomos de García Goyena y de los tres de las Partidas
// y crea data/goyena-*.json y data/partidas-*.json. Se ejecuta en la construcción (Render:
// buildCommand). Con --force vuelve a descargar.
import { ingest as ingestGoyena } from "./goyena.js";
import { ingest as ingestPartidas } from "./partidas.js";
const force = process.argv.includes("--force");
const resumen = [...(await ingestGoyena({ force })), ...(await ingestPartidas({ force }))];
console.error(resumen.join("\n"));
// No falla la construcción si archive.org no responde: el servidor reintentará al primer uso.
