import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { correr } from './util.mjs';

const ANCHO = 1080;
const ALTO = 1920;

// Colores de ASS en formato &HAABBGGRR
const AMARILLO = '&H0000D1FF'; // #FFD100
const AZUL = '&H00521E0A'; // #0A1E52: azul oscuro, se lee sobre la cancha (azul claro) y sobre el fondo del juego
const BLANCO = '&H00FFFFFF';
const NEGRO = '&H00000000';

const tiempoASS = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const seg = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// Saca los caracteres que ASS interpreta como comandos.
const limpiar = (s) => s.replace(/[{}]/g, '').replace(/\\/g, '/');

// Subtítulos "karaoke": cada palabra se pinta de amarillo en el momento en que se dice.
function karaoke(texto, segundos) {
  const palabras = limpiar(texto).split(/\s+/).filter(Boolean);
  const letras = palabras.reduce((n, p) => n + p.length, 0) || 1;
  let restante = Math.round(segundos * 100);
  return palabras
    .map((p, i) => {
      const cs = i === palabras.length - 1 ? restante : Math.round((p.length / letras) * segundos * 100);
      restante -= cs;
      return `{\\k${Math.max(1, cs)}}${p}`;
    })
    .join(' ');
}

// Las márgenes dejan libres la parte de arriba (pestañas de TikTok), la columna de botones
// de la derecha y la descripción de abajo. Sin cta (videos de opinión) no van la marca ni la placa final.
function armarSubtitulos({ guion, tiempos, total, video, cta }) {
  const f = process.env.BOT_FUENTE || video.fuente; // en Windows no está DejaVu Sans: BOT_FUENTE=Verdana (misma forma)
  const c = video.cierre;
  const inicioCierre = cta ? total - c.segundos : total;
  const finGancho = Math.min(2.6, inicioCierre);
  const eventos = [
    `Dialogue: 1,${tiempoASS(0)},${tiempoASS(finGancho)},Gancho,,0,0,0,,{\\fad(0,200)}${limpiar(guion.gancho)}`,
    ...(cta ? [`Dialogue: 0,${tiempoASS(finGancho)},${tiempoASS(inicioCierre)},Marca,,0,0,0,,${limpiar(video.marca)}`] : []),
    ...tiempos.map(
      (t) => `Dialogue: 0,${tiempoASS(t.inicio)},${tiempoASS(Math.min(t.fin, inicioCierre))},Sub,,0,0,0,,${karaoke(t.texto, t.fin - t.inicio)}`,
    ),
    ...(cta
      ? [
          `Dialogue: 2,${tiempoASS(inicioCierre)},${tiempoASS(total)},Cierre,,0,0,0,,{\\fad(250,0)}${limpiar(c.titulo)}` +
            `\\N\\N{\\c${AMARILLO}\\fs96}${limpiar(c.web)}\\N{\\fs54\\c${BLANCO}}${limpiar(c.detalle)}`,
        ]
      : []),
  ];
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${ANCHO}
PlayResY: ${ALTO}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${f},80,${AMARILLO},${BLANCO},${NEGRO},&H64000000,-1,0,0,0,100,100,0,0,1,7,2,2,90,150,620,1
Style: Gancho,${f},86,${BLANCO},${BLANCO},${AZUL},${NEGRO},-1,0,0,0,100,100,0,0,3,20,0,8,80,80,260,1
Style: Marca,${f},40,${BLANCO},${BLANCO},${NEGRO},&H80000000,-1,0,0,0,100,100,0,0,1,3,0,8,80,80,250,1
Style: Cierre,${f},80,${BLANCO},${BLANCO},${NEGRO},${NEGRO},-1,0,0,0,100,100,0,0,1,6,0,5,90,150,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${eventos.join('\n')}
`;
}

// Junta todo en un MP4 vertical 1080x1920 listo para TikTok, más una portada en JPG.
// Si la grabación dura más que la voz, se acelera un poco (hasta "acelerarHasta" veces) para que entre lo importante;
// lo que sobra después se corta.
export async function editarVideo({ base, desde = 0, voz, guion, musica, video, carpeta, cta = true, grabado = 0, acelerarHasta = 1.25 }) {
  const total = voz.duracion + 0.4 + (cta ? video.cierre.segundos : (video.colaSinCta ?? 1.2));
  const inicioCierre = cta ? total - video.cierre.segundos : total;
  const rapido = Math.min(acelerarHasta, Math.max(1, grabado / total));
  await writeFile(path.join(carpeta, 'subtitulos.ass'), armarSubtitulos({ guion, tiempos: voz.tiempos, total, video, cta }));

  const entradas = ['-ss', String(desde), '-stream_loop', '-1', '-i', base, '-i', voz.audio];
  let audio = `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,apad[voz];[voz]`;
  if (musica) {
    // La música baja sola cuando habla la voz (ducking).
    entradas.push('-stream_loop', '-1', '-i', musica);
    audio =
      `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,apad,asplit=2[voz1][voz2];` +
      `[2:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${video.volumenMusica}[mus];` +
      `[mus][voz1]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=400[bajo];` +
      `[bajo][voz2]amix=inputs=2:duration=longest:normalize=0,`;
  }
  const filtros =
    `[0:v]setpts=PTS/${rapido.toFixed(3)},scale=${ANCHO}:${ALTO}:force_original_aspect_ratio=increase,crop=${ANCHO}:${ALTO},setsar=1,fps=${video.fps},` +
    (cta ? `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.65:t=fill:enable='gte(t,${inicioCierre.toFixed(2)})',` : '') +
    `ass=subtitulos.ass[v];` +
    `${audio}loudnorm=I=-14:TP=-1.5:LRA=11[a]`;

  const salida = path.join(carpeta, 'video.mp4');
  await correr(
    'ffmpeg',
    [
      '-y', ...entradas,
      '-filter_complex', filtros,
      '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
      '-movflags', '+faststart',
      'video.mp4',
    ].map(String),
    { cwd: carpeta },
  );
  const portada = path.join(carpeta, 'portada.jpg');
  await correr('ffmpeg', ['-y', '-ss', '1.2', '-i', salida, '-frames:v', '1', '-q:v', '3', portada]);
  return { video: salida, portada, total, rapido };
}
