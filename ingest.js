// Descarga el OCR de los cuatro tomos de García Goyena desde archive.org y crea data/goyena-*.json.
// Se ejecuta en la construcción (Render: buildCommand). Con --force vuelve a descargar.
import { ingest } from "./goyena.js";
const resumen = await ingest({ force: process.argv.includes("--force") });
console.error(resumen.join("\n"));
// No falla la construcción si archive.org no responde: el servidor reintentará al primer uso.
