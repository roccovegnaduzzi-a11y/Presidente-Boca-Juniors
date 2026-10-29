// Hoja de control: 6 cuadros del video final con las zonas que tapa la app de TikTok pintadas de rojo
// (arriba las pestañas, a la derecha la columna de botones y abajo el usuario, la descripción y el sonido).
// Sirve para ver de un vistazo que el juego llene el cuadro y que ningún texto quede debajo de los botones.
// Las zonas son aproximadas: cambian un poco según el celular.
//
//   node src/zonas.mjs salida/2026-10-29_18-17-00        (o la ruta de un video.mp4)
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { correr, duracion } from './util.mjs';

// En un video de 1080x1920
export const ZONAS_TIKTOK = [
  { nombre: 'pestañas de arriba', x: 0, y: 0, w: 1080, h: 150 },
  { nombre: 'botones de la derecha', x: 930, y: 700, w: 150, h: 860 },
  { nombre: 'usuario, descripción y sonido', x: 0, y: 1500, w: 1080, h: 420 },
];

export async function hojaDeZonas({ video, total, carpeta }) {
  const t = total ?? (await duracion(video));
  const cajas = ZONAS_TIKTOK.map((z) => `drawbox=x=${z.x}:y=${z.y}:w=${z.w}:h=${z.h}:color=red@0.32:t=fill`).join(',');
  const salida = path.join(carpeta, 'zonas.jpg');
  await correr('ffmpeg', [
    '-y', '-i', video,
    '-vf', `fps=6/${t.toFixed(2)},${cajas},scale=360:640,tile=6x1:padding=8:color=black`,
    '-frames:v', '1', '-q:v', '3', salida,
  ]);
  return salida;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = path.resolve(process.argv[2] ?? '.');
  const esCarpeta = (await stat(arg)).isDirectory();
  const video = esCarpeta ? path.join(arg, 'video.mp4') : arg;
  console.log(await hojaDeZonas({ video, carpeta: path.dirname(video) }));
}
