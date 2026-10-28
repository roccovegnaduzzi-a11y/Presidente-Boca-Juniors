import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renovarToken } from './tiktok.mjs';
import { RAIZ } from './util.mjs';

// TikTok puede devolver un refresh_token nuevo cada vez que se renueva, así que hay que guardarlo.
// Si están SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, se guarda en la tabla privada "ajustes" del
// juego (ahí no la puede leer ningún jugador). Si no, en el archivo local .tokens.json.
const CLAVE = 'tiktok_refresh_token';
const ARCHIVO = path.join(RAIZ, '.tokens.json');

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // clave vieja (JWT)
  return { url: url.replace(/\/$/, ''), headers };
}

export async function leerRefreshToken() {
  const sb = supabase();
  if (sb) {
    const r = await fetch(`${sb.url}/rest/v1/ajustes?clave=eq.${CLAVE}&select=valor`, { headers: sb.headers });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${await r.text()}`);
    const filas = await r.json();
    if (filas[0]?.valor) return filas[0].valor;
  } else {
    try {
      return JSON.parse(await readFile(ARCHIVO, 'utf8')).refresh_token;
    } catch {
      // todavía no se autorizó en esta compu
    }
  }
  return process.env.TIKTOK_REFRESH_TOKEN || null;
}

export async function guardarRefreshToken(refreshToken) {
  const sb = supabase();
  if (sb) {
    const r = await fetch(`${sb.url}/rest/v1/ajustes`, {
      method: 'POST',
      headers: { ...sb.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ clave: CLAVE, valor: refreshToken, nota: 'Bot de TikTok (no compartir)', actualizado: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`No pude guardar el token en Supabase: ${r.status} ${await r.text()}`);
    return 'Supabase (tabla ajustes)';
  }
  await writeFile(ARCHIVO, JSON.stringify({ refresh_token: refreshToken }, null, 2));
  return ARCHIVO;
}

export async function obtenerAccessToken() {
  const refresh = await leerRefreshToken();
  if (!refresh) throw new Error('No hay token de TikTok. Corré primero: npm run autorizar');
  const t = await renovarToken(refresh);
  if (t.refresh_token && t.refresh_token !== refresh) {
    if (supabase() || !process.env.TIKTOK_REFRESH_TOKEN) await guardarRefreshToken(t.refresh_token);
    else console.warn('TikTok devolvió un refresh_token nuevo y no hay dónde guardarlo: configurá Supabase o volvé a autorizar.');
  }
  return t.access_token;
}
