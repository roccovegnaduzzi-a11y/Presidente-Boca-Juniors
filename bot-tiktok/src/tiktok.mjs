import { open, stat } from 'node:fs/promises';

const API = process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com/v2'; // se puede cambiar para pruebas
const MB = 1024 * 1024;

export function tiktokConfigurado() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

export function urlAutorizacion({ redirectUri, scopes, state }) {
  const q = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    scope: scopes,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

async function pedirToken(campos) {
  const r = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      ...campos,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(`TikTok no dio el token: ${j.error ?? r.status} ${j.error_description ?? ''} (log_id ${j.log_id ?? '-'})`);
  }
  return j; // access_token (dura 24 h), refresh_token (dura 1 año), open_id, scope...
}

export const canjearCodigo = (code, redirectUri) =>
  pedirToken({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });

export const renovarToken = (refreshToken) => pedirToken({ grant_type: 'refresh_token', refresh_token: refreshToken });

async function llamar(token, ruta, cuerpo) {
  const r = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(cuerpo ?? {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.error && j.error.code !== 'ok')) {
    throw new Error(`TikTok ${ruta}: ${j.error?.code ?? r.status} ${j.error?.message ?? ''} (log_id ${j.error?.log_id ?? '-'})`);
  }
  return j.data;
}

// Reglas de TikTok: cada parte pesa entre 5 y 64 MB (la última puede llegar a 128 MB) y la
// cantidad de partes es el tamaño dividido el tamaño de parte, redondeado para abajo.
// Un video de TikTok de 30 segundos pesa mucho menos de 64 MB, así que casi siempre va entero.
function partes(tamano) {
  if (tamano <= 64 * MB) return { video_size: tamano, chunk_size: tamano, total_chunk_count: 1 };
  const chunk = 10 * MB;
  return { video_size: tamano, chunk_size: chunk, total_chunk_count: Math.floor(tamano / chunk) };
}

async function subirArchivo(uploadUrl, archivo, info) {
  const f = await open(archivo, 'r');
  try {
    for (let i = 0; i < info.total_chunk_count; i++) {
      const desde = i * info.chunk_size;
      const hasta = i === info.total_chunk_count - 1 ? info.video_size - 1 : desde + info.chunk_size - 1;
      const buffer = Buffer.alloc(hasta - desde + 1);
      await f.read(buffer, 0, buffer.length, desde);
      const r = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(buffer.length),
          'Content-Range': `bytes ${desde}-${hasta}/${info.video_size}`,
        },
        body: buffer,
      });
      if (r.status !== 201 && r.status !== 206) throw new Error(`Falló la subida de la parte ${i + 1}: ${r.status} ${await r.text()}`);
    }
  } finally {
    await f.close();
  }
}

async function esperarEstado(token, publishId) {
  for (let i = 0; i < 40; i++) {
    const d = await llamar(token, '/post/publish/status/fetch/', { publish_id: publishId });
    if (d.status === 'FAILED') throw new Error(`TikTok rechazó el video: ${d.fail_reason}`);
    if (d.status === 'SEND_TO_USER_INBOX' || d.status === 'PUBLISH_COMPLETE') return d.status;
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  return 'PROCESANDO (fijate en la app en unos minutos)';
}

// Modo borrador: el video llega a las notificaciones de TikTok. Desde la app le ponés el sonido
// en tendencia y publicás. Necesita el permiso video.upload.
export async function subirBorrador(token, archivo) {
  const info = partes((await stat(archivo)).size);
  const d = await llamar(token, '/post/publish/inbox/video/init/', { source_info: { source: 'FILE_UPLOAD', ...info } });
  await subirArchivo(d.upload_url, archivo, info);
  return { publishId: d.publish_id, estado: await esperarEstado(token, d.publish_id) };
}

// Modo directo: publica sin pasar por la app. Necesita el permiso video.publish, y mientras TikTok
// no apruebe la app (auditoría), solo deja publicar en cuentas privadas.
// El aviso de contenido promocional lo decide el dueño de la cuenta en la app, video por video: el bot nunca lo activa.
export async function publicarDirecto(token, archivo, { titulo, privacidad, segundos, etiquetaIA }) {
  const creador = await llamar(token, '/post/publish/creator_info/query/');
  if (!creador.privacy_level_options.includes(privacidad)) {
    throw new Error(`Tu cuenta no permite "${privacidad}". Opciones: ${creador.privacy_level_options.join(', ')}`);
  }
  if (segundos > creador.max_video_post_duration_sec) {
    throw new Error(`El video dura ${Math.round(segundos)} s y tu cuenta permite hasta ${creador.max_video_post_duration_sec} s.`);
  }
  const info = partes((await stat(archivo)).size);
  const d = await llamar(token, '/post/publish/video/init/', {
    post_info: {
      title: titulo.slice(0, 2200),
      privacy_level: privacidad,
      disable_duet: false,
      disable_stitch: false,
      disable_comment: false,
      video_cover_timestamp_ms: 1200,
      brand_organic_toggle: false, // el aviso de contenido promocional se pone (o no) a mano en la app
      brand_content_toggle: false,
      is_aigc: etiquetaIA, // la voz es generada con IA
    },
    source_info: { source: 'FILE_UPLOAD', ...info },
  });
  await subirArchivo(d.upload_url, archivo, info);
  return { publishId: d.publish_id, estado: await esperarEstado(token, d.publish_id), cuenta: creador.creator_username };
}
