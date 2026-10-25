# Concordantiae: el Código Civil en su historia y en sus fuentes

Conector MCP para estudiar el Código Civil español (BOE-A-1889-4763) en tres capas:

1. **Historia de cada artículo desde 1889**, con la norma que dio cada redacción, sacada de la API oficial de legislación consolidada del BOE.
2. **Concordancias con el derecho romano**: 66 artículos relacionados con 74 lugares del Digesto, las Instituciones de Gayo y de Justiniano y el Código de Justiniano. Cada cita se comprobó contra el texto crítico de la Bibliotheca Iuris Antiqui.
3. **García Goyena**, *Concordancias, motivos y comentarios del Código civil español* (Madrid, 1852), el comentario al Proyecto de 1851, en el texto OCR del ejemplar de la Universidad de Sevilla en archive.org (dominio público).

Se complementa con los otros dos conectores: para el texto vigente, la jurisprudencia o el BOE, el de fuentes jurídicas españolas; para leer entero un pasaje romano, el de fuentes del derecho romano (`citar("D. 9.2.1 pr.")`).

Todos los archivos van en la raíz del repositorio, sin carpetas y sin compilar. Los `fixture-*` y `*.test.js` son las pruebas (`npm test`).

## Herramientas

**Historia (BOE)**
- `cc_historia("154")`: cronología de todas las redacciones, con fecha de vigencia y norma («2/4 · vigente desde 08/06/1981 · Ley 11/1981, de 13 de mayo»), y el texto de cada una.
- `cc_version("154", "1995-03-01")`: el artículo tal como estaba en una fecha. También acepta `"original"`, `"vigente"` o el número de versión.
- `cc_comparar("154", "original", "vigente")`: cambios palabra a palabra, `[-suprimido-] {+añadido+}`, y las reformas intermedias.
- `cc_reformas(norma="Ley 8/2021")`: artículos a los que dio redacción una norma. Sin `norma`, lista las normas que han reformado el Código en un intervalo de fechas.

**Derecho romano**
- `cc_concordancias("1902")`: fuentes romanas del artículo, con un extracto latino breve, el tipo de relación (antecedente, contraste o tópico) y una nota. Con `goyena=true` añade los artículos del Proyecto de 1851 más parecidos. Sin artículo lista todos los cubiertos; con `consulta="usufructo"` busca por materia.
- `cc_fuente_romana("D. 9.2")`: búsqueda inversa, de un lugar romano a los artículos del Código.

**García Goyena (1852)**
- `goyena_articulo(1900)`: texto OCR de un artículo del Proyecto de 1851 con sus concordancias y el comentario, y enlace a la página escaneada.
- `goyena_buscar("ley Aquilia")`: búsqueda por palabras en los cuatro tomos.
- `goyena_para_cc("1902")`: propone el artículo del Proyecto que corresponde a un artículo del Código, comparando la redacción original de 1889 con el texto del Proyecto.

## Desplegar en Render como conector personalizado

1. Sube todos estos archivos a la raíz de un repositorio de GitHub.
2. En Render: **New → Blueprint**, elige el repositorio y pulsa **Apply**. `render.yaml` crea el servicio y una variable secreta `CC_SECRET`.
3. La construcción ejecuta `npm install && npm run ingest`, que descarga de archive.org el OCR de los cuatro tomos de García Goyena (unos 5 MB) a `data/`.
4. Comprueba que `https://<tu-servicio>.onrender.com/health` responde «concordantiae-mcp OK».
5. Copia el valor de `CC_SECRET` (servicio → Environment). La URL del conector es `https://<tu-servicio>.onrender.com/mcp/<CC_SECRET>`.
6. En claude.ai: **Ajustes → Conectores → Añadir conector personalizado**, con esa URL.

En el plan gratuito el servicio se duerme tras 15 minutos sin uso; la primera consulta tarda 30–60 s.

## Uso local (Claude Desktop / Claude Code)

`npm install`, `npm run ingest` (opcional: si no, se descarga al primer uso) y luego apunta a `node /ruta/index.js` (modo stdio). `npm test` ejecuta las pruebas.

## Cómo se ha hecho y limitaciones

- **Historia.** Sale entera del BOE: el bloque de cada artículo trae todas sus versiones desde el 16/08/1889, y las notas de cada versión («Se modifica por el art. 2 de la Ley 11/1981…  Ref. BOE-A-1981-11198») dan el nombre de la norma. Los 1976 artículos se localizan aunque el índice del BOE los titule de forma irregular («Art 32», «Art. 958 bis») o con ids que no siguen el número (el bloque del art. 94 bis se llama `a9`).
- **`cc_reformas`** descarga el Código completo con su historia (varios MB). La primera llamada tarda; después queda en caché 12 horas.
- **Concordancias romanas.** Es un conjunto seleccionado de instituciones que se estudian en Derecho Romano, no una tabla exhaustiva; que un artículo no tenga entrada no significa que carezca de antecedente romano. Las citas y los extractos se comprobaron el 25/10/2026 contra BIA (Digesto, Instituciones y Código, ed. Mommsen-Krueger; Gayo, ed. David). Las notas resumen la relación; contrástalas con el manual. No incluye todavía las Partidas.
- **García Goyena.** Es OCR del siglo XIX con errores. El índice de artículos del Proyecto se reconstruye detectando las cabeceras «ARTICULO n.» aunque estén mal leídas y comprobando que los números avancen; cuando una cabecera es ilegible, `goyena_articulo` lo advierte y muestra el tramo que la contiene. La correspondencia entre el Proyecto de 1851 y el Código de 1889 es una semejanza léxica con puntuación (≥ 0,5 probable, < 0,25 dudosa): compruébala siempre en el escaneo enlazado.
- Tomos en archive.org: T. 1 `BRes0414951`, T. 2 `BRes0414952`, T. 3 `BRes0414953` y T. 4 `BRes0414954` (este último se comprueba en la construcción; si no corresponde, se busca por título).
- **No probado aún en vivo contra el BOE**: las pruebas usan el índice real del Código y bloques reconstruidos con el formato de la API, porque el entorno de desarrollo no podía conectarse a boe.es. El análisis del XML reutiliza el de Hispanorum, que sí está probado en vivo.

Licencia MIT. Los datos de concordancias reproducen extractos breves de ediciones de BIA (CC BY-NC-SA 4.0).
