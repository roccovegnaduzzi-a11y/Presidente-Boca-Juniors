import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carpeta bot-tiktok/, para leer config.json, ideas.json, etc. sin importar desde dónde se corra.
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function leerJSON(ruta) {
  return JSON.parse(await readFile(ruta, 'utf8'));
}

// Corre un programa (ffmpeg, ffprobe) y devuelve lo que imprimió. Si falla, muestra el final del error.
export function correr(programa, args, opciones = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(programa, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opciones });
    let salida = '';
    let errores = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (errores += d));
    p.on('error', reject);
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
