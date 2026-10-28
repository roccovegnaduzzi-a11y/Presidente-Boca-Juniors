import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { correr, duracion } from './util.mjs';

const PAUSA = 0.15; // silencio entre frases, en segundos

const escaparXML = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Voz neural de Azure con acento argentino (es-AR-TomasNeural o es-AR-ElenaNeural).
async function sintetizarAzure(texto, voz, archivo) {
  const clave = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!clave || !region) {
    throw new Error('Faltan AZURE_SPEECH_KEY y AZURE_SPEECH_REGION. Configuralas o usá --voz ninguna.');
  }
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-AR">` +
    `<voice name="${voz.nombre}"><prosody rate="${voz.velocidad}">${escaparXML(texto)}</prosody></voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': clave,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'bot-tiktok-boca-presidente',
    },
    body: ssml,
  });
  if (!r.ok) throw new Error(`Azure respondió ${r.status}: ${await r.text()}`);
  await writeFile(archivo, Buffer.from(await r.arrayBuffer()));
}

// Arma la pista de voz frase por frase. Así sabemos exactamente cuándo empieza y termina
// cada frase, y los subtítulos quedan sincronizados sin tener que transcribir el audio.
// Con proveedor "ninguna" calcula los tiempos a ojo y deja silencio (para probar, o para
// grabar la voz o poner un sonido directamente en TikTok).
export async function generarVoz({ lineas, voz, carpeta }) {
  const tiempos = [];
  const partes = [];
  let t = 0;

  for (const [i, texto] of lineas.entries()) {
    const parte = path.join(carpeta, `voz-${String(i + 1).padStart(2, '0')}.wav`);
    let largo;
    if (voz.proveedor === 'ninguna') {
      const palabras = texto.split(/\s+/).length;
      largo = Math.max(1.2, palabras / 2.7 + 0.35);
      await correr('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(largo + PAUSA), parte]);
    } else if (voz.proveedor === 'azure') {
      const mp3 = parte.replace(/\.wav$/, '.mp3');
      await sintetizarAzure(texto, voz, mp3);
      largo = await duracion(mp3);
      await correr('ffmpeg', ['-y', '-i', mp3, '-af', `apad=pad_dur=${PAUSA}`, '-ar', '44100', '-ac', '1', parte]);
    } else {
      throw new Error(`Proveedor de voz desconocido: ${voz.proveedor}`);
    }
    tiempos.push({ texto, inicio: t, fin: t + largo });
    partes.push(parte);
    t += await duracion(parte);
  }

  const lista = path.join(carpeta, 'voz-lista.txt');
  await writeFile(lista, partes.map((p) => `file '${path.basename(p)}'`).join('\n'));
  const audio = path.join(carpeta, 'voz.wav');
  await correr('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', audio], { cwd: carpeta });
  const sobrantes = [lista, ...partes, ...partes.map((p) => p.replace(/\.wav$/, '.mp3'))];
  await Promise.all(sobrantes.map((f) => rm(f, { force: true })));
  return { audio, tiempos, duracion: t };
}
