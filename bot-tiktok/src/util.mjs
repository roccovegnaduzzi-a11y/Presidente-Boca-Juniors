import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carpeta bot-tiktok/, para leer config.json, ideas.json, etc. sin importar desde dónde se corra.
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Donde quedan los videos. BOT_SALIDA los lleva a otra carpeta (por ejemplo, fuera de OneDrive, que traba los archivos).
export const SALIDA = process.env.BOT_SALIDA ? path.resolve(process.env.BOT_SALIDA) : path.join(RAIZ, 'salida');

export async function leerJSON(ruta) {
  return JSON.parse(await readFile(ruta, 'utf8'));
}

// Corre un programa (ffmpeg, ffprobe) y devuelve lo que imprimió. Si falla, muestra el final del error.
// FFMPEG_DIR: la carpeta de ffmpeg y ffprobe, si no están en el PATH.
export function correr(programa, args, opciones = {}) {
  const ejecutable = process.env.FFMPEG_DIR && /^ff(mpeg|probe)$/.test(programa) ? path.join(process.env.FFMPEG_DIR, programa) : programa;
  return new Promise((resolve, reject) => {
    const p = spawn(ejecutable, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opciones });
    let salida = '';
    let errores = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (errores += d));
    p.on('error', (e) =>
      reject(e.code === 'ENOENT' && /^ff/.test(programa) ? new Error(`No encuentro ${programa}. Instalá ffmpeg (mirá el README) o decí en qué carpeta está con FFMPEG_DIR.`) : e),
    );
    p.on('close', (codigo) => {
      if (codigo === 0) resolve(salida);
      else reject(new Error(`${programa} terminó con código ${codigo}:\n${errores.slice(-3000)}`));
    });
  });
}

export async function duracion(archivo) {
  const s = await correr('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', archivo]);
  const d = parseFloat(s);
  if (!Number.isFinite(d)) throw new Error(`No pude medir la duración de ${archivo}`);
  return d;
}
