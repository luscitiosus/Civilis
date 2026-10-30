# Concordantiae: el Código Civil en su historia y en sus fuentes

Conector MCP para estudiar el Código Civil español (BOE-A-1889-4763) en estas capas:

1. **Historia de cada artículo desde 1889**, con la norma que dio cada redacción, sacada de la API oficial de legislación consolidada del BOE.
2. **Concordancias con el derecho romano**: 66 artículos relacionados con 74 lugares del Digesto, las Instituciones de Gayo y de Justiniano y el Código de Justiniano. Cada cita se comprobó contra el texto crítico de la Bibliotheca Iuris Antiqui.
3. **García Goyena**, *Concordancias, motivos y comentarios del Código civil español* (Madrid, 1852), el comentario al Proyecto de 1851, en el texto OCR del ejemplar de la Universidad de Sevilla en archive.org (dominio público). Las fuentes que cita cada comentario (Digesto, Código, Partidas, Leyes de Toro, fueros, recopilaciones) se extraen y se pasan a notación moderna.
4. **Derecho histórico castellano**: las *Siete Partidas* en la edición de la Real Academia de la Historia (Madrid, 1807), también en OCR de un ejemplar de la Universidad de Sevilla en archive.org.
5. **El Code civil des Français de 1804** (Code Napoléon), modelo principal del Proyecto de 1851, en su redacción original, de la transcripción de Wikisource. Las remisiones de García Goyena al Code («tomado de los 319 y 320 Franceses») enlazan cada artículo del Código Civil con su fuente francesa.
6. **Manresa**, *Comentarios al Código Civil español* (Madrid, 1890 y ss.), el comentario de los años inmediatamente posteriores a la promulgación: hace con el Código lo que Goyena hace con el Proyecto. OCR de archive.org; de cada tomo se usa el ejemplar más antiguo digitalizado.
7. **Brocardos**: 26 reglas latinas («superficies solo cedit», «emptio tollit locatum»…) con su lugar romano comprobado en BIA, si la frase está literalmente en la fuente o es posterior, y los artículos que la recogen o se apartan de ella.

Se complementa con los otros dos conectores: para el texto vigente, la jurisprudencia o el BOE, el de fuentes jurídicas españolas; para leer entero un pasaje romano, el de fuentes del derecho romano (`citar("D. 9.2.1 pr.")`).

Todos los archivos van en la raíz del repositorio, sin carpetas y sin compilar. Los `fixture-*` y `*.test.js` son las pruebas (`npm test`).

## Herramientas

**Historia (BOE)**
- `cc_historia("154")`: cronología de todas las redacciones, con fecha de vigencia y norma («2/4 · vigente desde 08/06/1981 · Ley 11/1981, de 13 de mayo»), y el texto de cada una.
- `cc_version("154", "1995-03-01")`: el artículo tal como estaba en una fecha. También acepta `"original"`, `"vigente"` o el número de versión.
- `cc_comparar("154", "original", "vigente")`: cambios palabra a palabra, `[-suprimido-] {+añadido+}`, y las reformas intermedias.
- `cc_reformas(norma="Ley 8/2021")`: artículos a los que dio redacción una norma. Sin `norma`, lista las normas que han reformado el Código en un intervalo de fechas.

**Derecho romano**
- `cc_concordancias("1902")`: fuentes romanas del artículo, con un extracto latino breve, el tipo de relación (antecedente, contraste o tópico) y una nota. Con `goyena=true` añade los artículos del Proyecto de 1851 más parecidos y las fuentes que cita el comentario de Goyena; si el artículo no tiene concordancias registradas, esas fuentes se añaden siempre. Sin artículo lista todos los cubiertos; con `consulta="usufructo"` busca por materia.
- `cc_fuente_romana("D. 9.2")`: búsqueda inversa, de un lugar romano a los artículos del Código, y también a los comentarios de García Goyena que lo citan.

**García Goyena (1852)**
- `goyena_articulo(1900)`: texto OCR de un artículo del Proyecto de 1851 con sus concordancias y el comentario, y enlace a la página escaneada.
- `goyena_buscar("ley Aquilia")`: búsqueda por palabras en los cuatro tomos.
- `goyena_para_cc("1902")`: propone el artículo del Proyecto que corresponde a un artículo del Código, comparando la redacción original de 1889 con el texto del Proyecto.
- `goyena_citas(107)`: fuentes que cita el comentario a un artículo del Proyecto, en notación moderna y con el fragmento del OCR de donde sale cada una: «ley 129 de verborum significatione» → D. 50.16.129; «leyes 3 y 5, título 25, Partida 4» → P. 4.25.3 y P. 4.25.5; «ley 13 de Toro» → Toro 13; «ley 17, título 2, libro 4 del Fuero Juzgo» → FJ 4.2.17; «ley 6, título 14, libro 1, Novísima Recopilación» → Nov. Rec. 1.14.6.
- `goyena_citado("D. 1.5")`: búsqueda inversa, de una fuente (romana, Partidas, Toro…) a los comentarios de Goyena que la citan y al artículo del Código que corresponde a cada uno. Admite un título entero. La primera consulta descarga el Código completo del BOE y tarda.

**Brocardos**
- `cc_brocardos(articulo="358")`, `cc_brocardos(consulta="venta quita renta")` o `cc_brocardos(fuente="D. 50.17")`: brocardo, traducción, lugar romano con extracto, tipo de formulación (literal, equivalente o punto de partida) y artículos del Código con su relación. `cc_concordancias` y `cc_fuente_romana` los muestran también.

**Code civil de 1804**
- `code_articulo(1382)`: texto original francés, con Livre, Titre y Chapitre, y los artículos del Proyecto de 1851 que según García Goyena lo toman como fuente, con el artículo del Código Civil que corresponde a cada uno.
- `code_buscar("propriété du sol")`: búsqueda por palabras en francés.
- `code_para_cc("1902")`: Código Civil → Proyecto de 1851 (por semejanza) → artículos del Code de los que Goyena dice tomarlo, con su texto.

**Manresa (1890 y ss.)**
- `manresa_articulo("358")`: comentario de Manresa al artículo, con tomo, edición, año, página y enlace al escaneo, y las fuentes que cita (leídas en el OCR). Los comentarios largos se leen por partes con `offset`.
- `manresa_buscar("accesión")`: búsqueda por palabras en los doce tomos.

**Derecho histórico (Partidas)**
- `historico_citar("P. 4.23.5")`: texto OCR de una ley de las Partidas, con la rúbrica del título y de la ley, enlace al escaneo y los comentarios de Goyena que la citan. También admite «Partida 4, título 23, ley 5».
- `historico_buscar("ayuntamiento de marido")`: búsqueda por palabras, con la ley en que cae cada resultado (grafía medieval: «fijo», «home», «facer»).

## Desplegar en Render como conector personalizado

1. Sube todos estos archivos a la raíz de un repositorio de GitHub.
2. En Render: **New → Blueprint**, elige el repositorio y pulsa **Apply**. `render.yaml` crea el servicio y una variable secreta `CC_SECRET`.
3. La construcción ejecuta `npm install && npm run ingest`, que descarga a `data/` el OCR de los cuatro tomos de García Goyena, los tres de las Partidas y los doce de Manresa (archive.org), y el Code de 1804 (Wikisource). Se guarda solo el texto por páginas, unos 30 MB en total; la descarga puede ser mayor si hay que usar el `_djvu.xml`. El resumen de la construcción dice cuántos artículos se han reconocido en cada fuente.
4. Comprueba que `https://<tu-servicio>.onrender.com/health` responde «concordantiae-mcp OK».
5. Copia el valor de `CC_SECRET` (servicio → Environment). La URL del conector es `https://<tu-servicio>.onrender.com/mcp/<CC_SECRET>`.
6. En claude.ai: **Ajustes → Conectores → Añadir conector personalizado**, con esa URL.

En el plan gratuito el servicio se duerme tras 15 minutos sin uso; la primera consulta tarda 30–60 s.

## Uso local (Claude Desktop / Claude Code)

`npm install`, `npm run ingest` (opcional: si no, se descarga al primer uso) y luego apunta a `node /ruta/index.js` (modo stdio). `npm test` ejecuta las pruebas.

## Si la API del BOE no responde

La API de datos abiertos del BOE a veces devuelve HTTP 500 durante horas (el 30/10/2026 falló para todas las normas). Las herramientas que leen el Código (`cc_historia`, `cc_version`, `cc_comparar`, `cc_reformas`, y por debajo `cc_concordancias`, `goyena_para_cc` y `code_para_cc`) siguen este orden:

1. **API** (`/legislacion-consolidada/id/BOE-A-1889-4763/…`), como siempre.
2. **Copia de respaldo** en `respaldo/`: el índice y el texto completo con todas las versiones, comprimidos (`cc-indice.json.gz`, `cc-texto.xml.gz`) y con su metadata (`cc-respaldo.json`: fecha de descarga, fecha de actualización del Código en el BOE, huellas SHA-256). Da lo mismo que la API, pero con fecha.
3. **Página web** del texto consolidado (`https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763`), que es otro servicio del BOE. Solo trae la redacción vigente (con las notas de reforma y las fechas de cada redacción, sin su texto). Por eso solo sirve para `cc_version` con `version="vigente"` y para un `cc_historia` reducido. Las demás herramientas responden con un error explicado, en vez de tomar el texto vigente por el de 1889.

Cuando la respuesta no viene de la API lo dice en un `AVISO:` de la cabecera, con la fecha de la copia o la URL de la página. Tras un fallo, la API no se reintenta durante 5 minutos (`CC_API_PAUSA_MS`).

**Actualizar la copia.** `npm run respaldo` la descarga y la sustituye solo si el Código ha cambiado en el BOE y la descarga está completa (al menos 1900 artículos). Si el BOE falla, conserva la copia anterior y termina con un aviso (`--estricto` para que falle). El workflow `.github/workflows/respaldo-boe.yml` lo ejecuta cada lunes y también a mano (*Actions → Copia de respaldo del Código Civil → Run workflow*), y hace commit solo si hay cambios. **La primera copia hay que generarla** lanzando el workflow a mano cuando la API responda. Render la recibe en el siguiente despliegue.

Los datos del BOE se reutilizan según su [aviso legal](https://www.boe.es/informacion/aviso_legal/). Fuente: Agencia Estatal Boletín Oficial del Estado.

## Cómo se ha hecho y limitaciones

- **Historia.** Sale entera del BOE: el bloque de cada artículo trae todas sus versiones desde el 16/08/1889, y las notas de cada versión («Se modifica por el art. 2 de la Ley 11/1981…  Ref. BOE-A-1981-11198») dan el nombre de la norma. Los 1976 artículos se localizan aunque el índice del BOE los titule de forma irregular («Art 32», «Art. 958 bis») o con ids que no siguen el número (el bloque del art. 94 bis se llama `a9`).
- **`cc_reformas`** descarga el Código completo con su historia (varios MB). La primera llamada tarda; después queda en caché 12 horas.
- **Concordancias romanas.** Es un conjunto seleccionado de instituciones que se estudian en Derecho Romano, no una tabla exhaustiva; que un artículo no tenga entrada no significa que carezca de antecedente romano. Las citas y los extractos se comprobaron el 25/10/2026 contra BIA (Digesto, Instituciones y Código, ed. Mommsen-Krueger; Gayo, ed. David). Las notas resumen la relación; contrástalas con el manual. No incluye todavía las Partidas.
- **García Goyena.** Es OCR del siglo XIX con errores. El índice de artículos del Proyecto se reconstruye detectando las cabeceras «ARTICULO n.» aunque estén mal leídas y comprobando que los números avancen. Si el número de una cabecera es ilegible («ARTICULO lí).»), se deduce por la secuencia cuando el hueco cuadra (18, ilegible, 20 → 19), y `goyena_articulo` y `goyena_para_cc` lo marcan como «número deducido». Si ni así se identifica, `goyena_articulo` lo advierte y muestra el tramo que lo contiene (o, para los primeros artículos de un tomo, el texto que precede al primero reconocido). El índice se calcula al cargar los datos, de modo que sus mejoras no exigen volver a descargar. La correspondencia entre el Proyecto de 1851 y el Código de 1889 es una semejanza léxica con puntuación (≥ 0,5 probable, < 0,25 dudosa), que iguala grafías de la época («estranjero/extranjero»): compruébala siempre en el escaneo enlazado.
- **Citas de García Goyena.** Se reconocen solo si los números se leen limpios, van precedidas de «ley», «leyes», «la(s)» o «recopilada(s)» (o encadenadas a otra cita) y caen dentro de la obra: los títulos de cada libro del Digesto, las 7 Partidas con sus 34 títulos como máximo, las 83 leyes de Toro… Se prefiere perder una cita a inventarla, pero un número mal leído dentro de rango («título 3» por «título 5») da una cita equivocada: compruébalas siempre leyendo el pasaje. Si una cita de las Partidas no cuadra con el texto, puede deberse también a la diferencia de numeración entre ediciones (véase el punto siguiente).
- **Partidas.** Edición de la Real Academia de la Historia (1807), tres tomos (BRes002050–002052). El índice se reconstruye con las cabeceras «TITULO XXIII» y «LEY V.» (números romanos, tolerando l y 1 por I) y las cabeceras de página «PARTIDA IV.»; un título o una ley solo se aceptan si siguen al anterior, y una tabla de títulos que no contenga leyes se descarta. Si la cabecera de una ley no se lee, `historico_citar` lo advierte y muestra el tramo que la contiene. La numeración de 1807 puede no coincidir con la de Gregorio López (1555), la que tenía autoridad en el foro y la que probablemente sigue García Goyena. Las Leyes de Toro, el Fuero Juzgo, el Fuero Real y la Novísima Recopilación se reconocen como citas, pero el conector aún no tiene su texto.
- **Páginas de García Goyena.** El `_djvu.txt` de archive.org no siempre separa las hojas, así que el texto se pagina, por este orden, con el hOCR (índice por hoja), el `_djvu.xml`, los saltos de página del `_djvu.txt` o, en último caso, las cabeceras impresas («30 CONCORDANCIAS, MOTIVOS Y COMENTARIOS» / «DEL CÓDIGO CIVIL ESPAÑOL. 31»). Los números de página impresos se leen de esas cabeceras y se corrigen por la secuencia (el OCR lee a veces 51 por 31). Los enlaces van a la hoja del escaneo (`page/nX`) o, si solo se conoce la página impresa, a ella (`page/31`). Los datos llevan un número de formato: los descargados con una versión anterior se vuelven a descargar solos.
- **Code civil de 1804.** Se descarga con la API de MediaWiki la página «Code civil des Français 1804/Texte entier» de Wikisource en francés; si no da el Código completo (2281 artículos), se recorren las subpáginas que enlaza la principal («…/Livre II, Titre II»). Las cabeceras «Art. 552.», «Article premier.» o «552.» solo se aceptan si el número avanza (de 1 a 4; hasta 12 con «Art.» explícito), para no confundirlas con enumeraciones internas, y el contexto (Livre, Titre, Chapitre, Section) se arrastra de las líneas de división. La edición oficial escaneada está en Gallica (ark:/12148/cb339642859).
- **Remisiones de García Goyena al Code.** Se leen las listas de números pegadas a «Francés/Franceses» («los 319 y 320 Franceses», «el 6 Francés», «552 al 555 del Código francés»), tolerando errores del OCR en la palabra; no se toman los números de otros códigos («212 y 213 de la Luisiana») ni los que van separados por «y el». Un número mal leído (520 por 320) da un artículo equivocado: compara el texto francés con el del Proyecto.
- **Manresa.** La Universidad de Sevilla tiene en archive.org la 1.ª edición (Imprenta de la Revista de Legislación, 1890 y ss., signatura B Res.045534: el T. 1 es `BRes0455341`) y la 4.ª (Reus, B Res.040526). Para cada tomo se buscan en archive.org los ejemplares de «Comentarios al Código Civil» de Manresa y se elige el de fecha más antigua; si la búsqueda falla, se prueba `BRes045534n`. La edición, la editorial y el año usados se guardan y salen en cada consulta. El índice se hace con las cabeceras «ARTÍCULO 1088», «ARTÍCULO 1.088.», «Artículo 32.» o «ARTÍCULOS 1089 Y 1090» (comentarios conjuntos), que deben ir solas en la línea y avanzar; la primera de cada tomo necesita que la confirme la siguiente. Manresa comenta la redacción de su época, no la vigente.
- **Brocardos.** `brocardos.json` es un conjunto seleccionado. Cada lugar y extracto se comprobó contra BIA y cada artículo contra su redacción vigente en el BOE el 25/10/2026. Muchos brocardos son medievales o modernos: el campo `formulacion` lo dice.
- **Sin probar todavía en vivo**: el análisis de Wikisource y la elección de ejemplares de Manresa se han probado con respuestas simuladas, porque el entorno de desarrollo no podía conectarse a Wikisource ni a archive.org. Revisa el resumen de la primera construcción: si el Code no llega a unos 2281 artículos o algún tomo de Manresa da 0 cabeceras, el formato real difiere del previsto.
- Tomos en archive.org: T. 1 `BRes0414951`, T. 2 `BRes0414952`, T. 3 `BRes0414953` y T. 4 `BRes0414954` (este último se comprueba en la construcción; si no corresponde, se busca por título).
- **No probado aún en vivo contra el BOE**: las pruebas usan el índice real del Código y bloques reconstruidos con el formato de la API, porque el entorno de desarrollo no podía conectarse a boe.es. El análisis del XML reutiliza el de Hispanorum, que sí está probado en vivo.

Licencia MIT. Los datos de concordancias y de brocardos reproducen extractos breves de ediciones de BIA (CC BY-NC-SA 4.0). El texto del Code de 1804 es de dominio público; su transcripción de Wikisource se descarga en la construcción y no se incluye en el repositorio.
