// Se corre una sola vez (npm run autorizar) para conectar el bot con tu cuenta de TikTok.
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { canjearCodigo, tiktokConfigurado, urlAutorizacion } from './tiktok.mjs';
import { guardarRefreshToken } from './tokens.mjs';

if (!tiktokConfigurado()) {
  console.error('Faltan TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET (los sacás de developers.tiktok.com).');
  process.exit(1);
}
const redirectUri = process.env.TIKTOK_REDIRECT_URI || 'https://bocapresidente.com/';
const scopes = process.env.TIKTOK_SCOPES || 'user.info.basic,video.upload';
const state = randomBytes(8).toString('hex');

console.log('\n1) Abrí este link con la cuenta de TikTok de Boca Presidente y aceptá:\n');
console.log(urlAutorizacion({ redirectUri, scopes, state }));
console.log(`\n2) TikTok te va a mandar a ${redirectUri} con "?code=..." en la barra de direcciones.`);

const consola = createInterface({ input: process.stdin, output: process.stdout });
const pegado = (await consola.question('\nPegá acá la dirección completa (o solo el code): ')).trim();
consola.close();

let code = pegado;
if (pegado.startsWith('http')) {
  const u = new URL(pegado);
  if (u.searchParams.get('state') !== state) console.warn('Ojo: el "state" no coincide; asegurate de haber usado el link de recién.');
  code = u.searchParams.get('code');
}
if (!code) {
  console.error('No encontré el code en lo que pegaste.');
  process.exit(1);
}

const t = await canjearCodigo(code, redirectUri);
const donde = await guardarRefreshToken(t.refresh_token);
console.log(`\nListo. Permisos: ${t.scope}. Token guardado en: ${donde}`);
