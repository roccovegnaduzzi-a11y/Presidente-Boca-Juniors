// Arma un video de Boca Presidente para TikTok y, si querés, lo sube.
//
//   node src/main.mjs                          guion con Claude + datos reales + grabación del juego → archivo
//   node src/main.mjs --modo borrador          …y lo manda a tus borradores de TikTok
//   node src/main.mjs --tema "Boca perdió el clásico" --cta no
//   node src/main.mjs --video mi-grabacion.mp4 --musica tema.mp3
//
// Opciones: --modo archivo|borrador|directo  --formato <id de ideas.json>  --tema <texto>  --cta si|no
//           --recorrido <id de config.json>  --video <grabación propia>  --guion <json escrito a mano>
//           --datos auto|ninguno|<json>  --musica <mp3 con derechos de uso>  --voz ninguna|azure
//           --url <otra dirección del juego>  --solo-datos (muestra los datos reales y termina)
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { leerDatos } from './datos.mjs';
import { editarVideo } from './editar.mjs';
import { grabarJuego } from './grabar.mjs';
import { generarGuion, limpiarGuion, revisarGuion } from './guion.mjs';
import { publicarDirecto, subirBorrador, tiktokConfigurado } from './tiktok.mjs';
import { obtenerAccessToken } from './tokens.mjs';
import { leerJSON, RAIZ, SALIDA } from './util.mjs';
import { generarVoz } from './voz.mjs';
import { hojaDeZonas } from './zonas.mjs';

const { values: op } = parseArgs({
  options: {
    modo: { type: 'string', default: 'archivo' },
    formato: { type: 'string' },
    tema: { type: 'string' },
    cta: { type: 'string' },
    recorrido: { type: 'string' },
    video: { type: 'string' },
    guion: { type: 'string' },
    datos: { type: 'string', default: 'auto' },
    musica: { type: 'string' },
    voz: { type: 'string' },
    url: { type: 'string' },
    'solo-datos': { type: 'boolean' },
  },
});
if (!['archivo', 'borrador', 'directo'].includes(op.modo)) throw new Error(`Modo desconocido: ${op.modo}`);
if (op.cta && !['si', 'no'].includes(op.cta)) throw new Error('--cta tiene que ser "si" o "no"');
const tema = op.tema?.trim() || undefined;

const config = await leerJSON(path.join(RAIZ, 'config.json'));
if (op.voz) config.voz.proveedor = op.voz;
const vozPropia = config.voz.proveedor === 'ninguna';
const url = op.url ? (op.url.startsWith('http') ? op.url : pathToFileURL(path.resolve(op.url)).href) : config.juego.url;

if (op['solo-datos']) {
  console.log(JSON.stringify(await leerDatos({ url }), null, 2));
  process.exit(0);
}

// Carpeta de salida: salida/2026-10-28_18-30-00
const sello = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
const carpeta = path.join(SALIDA, sello);
await mkdir(carpeta, { recursive: true });

// 0) Formato: el que se pide, el de reacción si hay tema, o uno distinto cada día
const ideas = await leerJSON(path.join(RAIZ, 'ideas.json'));
let formato;
if (op.formato) {
  formato = ideas.find((i) => i.id === op.formato);
  if (!formato) throw new Error(`No existe el formato "${op.formato}". Mirá ideas.json.`);
} else if (!op.guion) {
  const posibles = ideas.filter((i) => tema || !i.requiereTema);
  const dia = Math.floor(Date.now() / 86400000);
  formato = (tema && ideas.find((i) => i.requiereTema)) || posibles[dia % posibles.length];
}
const cta = op.cta ? op.cta === 'si' : (formato?.cta ?? true);
const idRecorrido = op.recorrido ?? formato?.recorrido ?? config.juego.recorridoPorDefecto;
const recorrido = config.juego.recorridos[idRecorrido];
if (!recorrido && !op.video) throw new Error(`No existe el recorrido "${idRecorrido}". Mirá config.json → juego.recorridos.`);

// 1) Guion (con datos reales del juego y del ranking, si se puede)
let guion;
let datos;
if (op.guion) {
  guion = limpiarGuion(await leerJSON(path.resolve(op.guion)));
  const problemas = revisarGuion(guion, { cta });
  if (problemas.length) throw new Error(`El guion no pasó la revisión: ${problemas.join('; ')}`);
} else {
  if (op.datos === 'auto' && url.startsWith('http')) {
    console.log('Leyendo los datos reales (juego y ranking)...');
    datos = await leerDatos({ url });
  } else if (op.datos !== 'auto' && op.datos !== 'ninguno') {
    datos = await leerJSON(path.resolve(op.datos));
  }
  if (datos) await writeFile(path.join(carpeta, 'datos.json'), JSON.stringify(datos, null, 2));
  console.log(`Escribiendo guion (${formato.nombre}${cta ? '' : ', sin invitar a jugar'})...`);
  guion = await generarGuion({ formato, tema, datos, config, cta, vozPropia });
}
await writeFile(path.join(carpeta, 'guion.json'), JSON.stringify(guion, null, 2));
console.log(`Guion: ${guion.titulo}`);

// 2) Voz en off (por defecto ninguna: la grabás vos en TikTok)
console.log(vozPropia ? 'Voz: la grabás vos en TikTok (el video queda en silencio, con tiempo para leer)...' : `Generando voz (${config.voz.proveedor})...`);
const voz = await generarVoz({ lineas: guion.lineas, voz: config.voz, carpeta });

// 3) Imagen: grabación propia o grabación automática del juego
const segundos = voz.duracion + 0.4 + (cta ? config.video.cierre.segundos : (config.video.colaSinCta ?? 1.2));
let base;
let desde = 0;
let grabado = 0;
if (op.video) {
  base = path.resolve(op.video);
} else {
  console.log(`Grabando el juego (${url}, recorrido "${idRecorrido}")...`);
  ({ video: base, desde, duracion: grabado } = await grabarJuego({
    url,
    recorrido,
    segundos,
    carpeta,
    ocultarFotosReales: config.juego.ocultarFotosReales,
  }));
}

// 4) Edición
console.log('Editando...');
const final = await editarVideo({
  base,
  desde,
  voz,
  guion,
  musica: op.musica && path.resolve(op.musica),
  video: config.video,
  carpeta,
  cta,
  grabado,
  acelerarHasta: recorrido?.acelerarHasta,
});
try {
  await hojaDeZonas({ video: final.video, total: final.total, carpeta });
} catch (e) {
  console.warn(`  (no pude armar la hoja de zonas: ${e.message.split('\n')[0]})`);
}

const descripcion = [guion.caption, guion.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join(' ');
await writeFile(path.join(carpeta, 'descripcion.txt'), `${descripcion}\n\nComentario para fijar:\n${guion.comentario_fijado}\n`);
// Para grabar la voz en TikTok: cada frase con el segundo en que aparece en pantalla
const reloj = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const paraLeer = voz.tiempos.map((t) => `${reloj(t.inicio)}  ${t.texto}`).join('\n');
if (vozPropia) await writeFile(path.join(carpeta, 'para-leer.txt'), `${paraLeer}\n`);

// 5) Publicación
let publicacion = 'No se subió: quedó como archivo.';
if (op.modo !== 'archivo') {
  if (!tiktokConfigurado()) {
    console.warn('Faltan las credenciales de TikTok: el video quedó solo como archivo.');
  } else {
    const token = await obtenerAccessToken();
    if (op.modo === 'borrador') {
      const r = await subirBorrador(token, final.video);
      publicacion = `Enviado a los borradores de TikTok (${r.estado}). Abrí la app${vozPropia ? ', grabá la voz leyendo los subtítulos' : ''}, poné un sonido en tendencia bajito y publicalo.`;
    } else {
      const r = await publicarDirecto(token, final.video, {
        titulo: descripcion,
        privacidad: config.tiktok.privacidad,
        segundos: final.total,
        etiquetaIA: !vozPropia && config.tiktok.etiquetaIA,
      });
      publicacion = `Publicado en @${r.cuenta} (${r.estado}).`;
    }
  }
}

const resumen = `## ${guion.titulo}

- Video: \`${path.relative(SALIDA, final.video)}\` (${final.total.toFixed(1)} s${final.rapido > 1.001 ? `, juego acelerado ×${final.rapido.toFixed(2)}` : ''})
- Formato: ${formato?.nombre ?? 'guion propio'} · ${cta ? 'invita a jugar' : 'sin invitar a jugar (opinión)'} · recorrido: ${op.video ? 'grabación propia' : idRecorrido}
- Datos reales: ${datos ? `sí (foto del ${datos.delJuego?.fotoReal ?? '-'}; ranking: ${datos.rankingDeJugadores ? 'sí' : 'no'})` : 'no'}
- ${publicacion}

**Descripción para TikTok**

${descripcion}

**Comentario para fijar**

${guion.comentario_fijado}
${vozPropia ? `\n**Para leer en TikTok** (el segundo en que aparece cada frase)\n\n\`\`\`\n${paraLeer}\n\`\`\`\n` : ''}`;
await writeFile(path.join(carpeta, 'resumen.md'), resumen);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, resumen);
console.log(`\n${resumen}`);
