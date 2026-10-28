// Arma un video de Boca Presidente para TikTok y, si querés, lo sube.
//
//   node src/main.mjs                          guion con Claude + grabación del juego → archivo
//   node src/main.mjs --modo borrador          …y lo manda a tus borradores de TikTok
//   node src/main.mjs --tema "Boca perdió el clásico"
//   node src/main.mjs --video mi-grabacion.mp4 --musica tema.mp3
//
// Opciones: --modo archivo|borrador|directo  --formato <id de ideas.json>  --tema <texto>
//           --video <grabación propia>  --guion <json escrito a mano>  --datos <json con datos del juego>
//           --musica <mp3 con derechos de uso>  --voz azure|ninguna  --url <otra dirección del juego>
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { editarVideo } from './editar.mjs';
import { grabarJuego } from './grabar.mjs';
import { generarGuion, limpiarGuion } from './guion.mjs';
import { publicarDirecto, subirBorrador, tiktokConfigurado } from './tiktok.mjs';
import { obtenerAccessToken } from './tokens.mjs';
import { leerJSON, RAIZ } from './util.mjs';
import { generarVoz } from './voz.mjs';

const { values: op } = parseArgs({
  options: {
    modo: { type: 'string', default: 'archivo' },
    formato: { type: 'string' },
    tema: { type: 'string' },
    video: { type: 'string' },
    guion: { type: 'string' },
    datos: { type: 'string' },
    musica: { type: 'string' },
    voz: { type: 'string' },
    url: { type: 'string' },
  },
});
if (!['archivo', 'borrador', 'directo'].includes(op.modo)) throw new Error(`Modo desconocido: ${op.modo}`);
const tema = op.tema?.trim() || undefined;

const config = await leerJSON(path.join(RAIZ, 'config.json'));
if (op.voz) config.voz.proveedor = op.voz;

// Carpeta de salida: salida/2026-10-28_18-30-00
const sello = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
const carpeta = path.join(RAIZ, 'salida', sello);
await mkdir(carpeta, { recursive: true });

// 1) Guion
let guion;
if (op.guion) {
  guion = limpiarGuion(await leerJSON(path.resolve(op.guion)));
} else {
  const ideas = await leerJSON(path.join(RAIZ, 'ideas.json'));
  const posibles = ideas.filter((i) => tema || !i.requiereTema);
  // Sin --formato: si hay tema, reacción a la noticia; si no, va rotando un formato por día.
  const dia = Math.floor(Date.now() / 86400000);
  const formato = op.formato
    ? ideas.find((i) => i.id === op.formato)
    : (tema && ideas.find((i) => i.requiereTema)) || posibles[dia % posibles.length];
  if (!formato) throw new Error(`No existe el formato "${op.formato}". Mirá ideas.json.`);
  console.log(`Escribiendo guion (${formato.nombre})...`);
  const datos = op.datos ? await leerJSON(path.resolve(op.datos)) : undefined;
  guion = await generarGuion({ formato, tema, datos, config });
}
await writeFile(path.join(carpeta, 'guion.json'), JSON.stringify(guion, null, 2));
console.log(`Guion: ${guion.titulo}`);

// 2) Voz en off
console.log(`Generando voz (${config.voz.proveedor})...`);
const voz = await generarVoz({ lineas: guion.lineas, voz: config.voz, carpeta });

// 3) Imagen: grabación propia o grabación automática del juego
const segundos = voz.duracion + 0.4 + config.video.cierre.segundos;
let base;
let desde = 0;
if (op.video) {
  base = path.resolve(op.video);
} else {
  const url = op.url ? (op.url.startsWith('http') ? op.url : pathToFileURL(path.resolve(op.url)).href) : config.juego.url;
  console.log(`Grabando el juego (${url})...`);
  ({ video: base, desde } = await grabarJuego({ url, juego: config.juego, segundos, carpeta }));
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
});

const descripcion = [guion.caption, guion.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join(' ');
await writeFile(path.join(carpeta, 'descripcion.txt'), `${descripcion}\n\nComentario para fijar:\n${guion.comentario_fijado}\n`);

// 5) Publicación
let publicacion = 'No se subió: quedó como archivo.';
if (op.modo !== 'archivo') {
  if (!tiktokConfigurado()) {
    console.warn('Faltan las credenciales de TikTok: el video quedó solo como archivo.');
  } else {
    const token = await obtenerAccessToken();
    if (op.modo === 'borrador') {
      const r = await subirBorrador(token, final.video);
      publicacion = `Enviado a los borradores de TikTok (${r.estado}). Abrí la app, poné un sonido en tendencia bajito y publicalo.`;
    } else {
      const r = await publicarDirecto(token, final.video, {
        titulo: descripcion,
        privacidad: config.tiktok.privacidad,
        segundos: final.total,
        etiquetaIA: config.voz.proveedor !== 'ninguna' && config.tiktok.etiquetaIA,
        marcaPropia: config.tiktok.marcaPropia,
      });
      publicacion = `Publicado en @${r.cuenta} (${r.estado}).`;
    }
  }
}

const resumen = `## ${guion.titulo}

- Video: \`${path.relative(RAIZ, final.video)}\` (${final.total.toFixed(1)} s)
- ${publicacion}

**Descripción para TikTok**

${descripcion}

**Comentario para fijar**

${guion.comentario_fijado}
`;
await writeFile(path.join(carpeta, 'resumen.md'), resumen);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, resumen);
console.log(`\n${resumen}`);
