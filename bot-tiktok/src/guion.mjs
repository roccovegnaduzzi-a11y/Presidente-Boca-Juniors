import Anthropic from '@anthropic-ai/sdk';

const ESQUEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Título interno corto para identificar el video' },
    gancho: { type: 'string', description: 'Texto grande en pantalla durante los primeros 2,5 segundos (máximo 8 palabras)' },
    lineas: { type: 'array', items: { type: 'string' }, description: 'Frases de la voz en off; cada una es un subtítulo' },
    caption: { type: 'string', description: 'Descripción del video en TikTok, sin hashtags' },
    hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags sin el símbolo #' },
    comentario_fijado: { type: 'string', description: 'Pregunta para fijar como primer comentario' },
  },
  required: ['titulo', 'gancho', 'lineas', 'caption', 'hashtags', 'comentario_fijado'],
  additionalProperties: false,
};

// cta: el video invita a jugar ("link en el perfil"). Sin cta es opinión o reacción de hincha y el juego queda de fondo.
// vozPropia: las frases las lee en voz alta el dueño de la cuenta, grabándose desde el editor de TikTok.
function sistema({ cta, vozPropia }) {
  return `Escribís guiones de TikTok para una cuenta personal de hinchas de Boca. El dueño de la cuenta hizo "Boca Presidente" (bocapresidente.com), un juego web gratis donde sos presidente de Boca: armás el plantel, manejás la plata y buscás la Séptima Libertadores.

Los videos muestran el juego en pantalla, con subtítulos y voz en off. ${
    vozPropia
      ? 'La voz la graba el dueño de la cuenta leyendo las frases desde el editor de TikTok: que suenen naturales dichas por un pibe hincha, cortas, fáciles de leer de corrido y sin palabras difíciles de pronunciar.'
      : 'La voz es la de un hincha argentino.'
  } Voseo, humor futbolero, cargadas sanas.

Reglas:
- "lineas": de 6 a 9 frases de 3 a 9 palabras cada una. En total, entre 18 y 28 segundos hablados.
- La primera frase es el gancho hablado: tiene que frenar el scroll en 2 segundos.
${
  cta
    ? '- La última frase invita a jugar con "link en el perfil". No digas la dirección web: aparece escrita en pantalla.'
    : '- Este video NO es publicidad: es la opinión o la reacción de un hincha, y el juego aparece de fondo como apoyo. No invites a jugar, no digas "link en el perfil", "jugalo", "gratis" ni la dirección web. Podés nombrar el juego una vez ("en el juego") si suma. Cerrá con una opinión o una pregunta a los hinchas.'
}
- "gancho": texto en pantalla de hasta 8 palabras. Puede complementar la primera frase en vez de repetirla.
- "caption": ${
    cta
      ? 'arrancá con lo que alguien buscaría en TikTok (por ejemplo "Juego de Boca" o "Simulador de presidente de Boca").'
      : 'como lo escribiría un hincha en su cuenta, sin promocionar nada.'
  } Máximo 150 caracteres, sin hashtags.
- "hashtags": de 3 a 5, en minúscula y sin el símbolo #.
- "comentario_fijado": una pregunta que invite a comentar o a votar.
- Sin emojis en "gancho" ni en "lineas" (se dibujan sobre el video). En "caption" y "comentario_fijado" sí podés usarlos.
- Si te pasan datos reales, usá solo esos: lo de la realidad (resultados, tablas, lesionados, próximos partidos) se cuenta como real y lo que pasa en el juego, como algo del juego. No inventes estadísticas, resultados, jugadores ni declaraciones.
- No digas que es el juego oficial del club ni hables mal de personas reales.
- Nada de insultos (tampoco apodos ofensivos para otros clubes), violencia, barras, discriminación ni apuestas.`;
}

// Lo que no puede aparecer en un guion. Es un chequeo simple de palabras: por eso las reglas también van en el pedido.
const PROHIBIDO = /\b(barras?( bravas?)?|apuest\w*|apost\w*|casinos?|bet(365|ano|sson|warrior)?|codere|bplay|matar\w*|muert\w*|pi[ñn]as?|trompadas?|cagar\w*|put[oa]s?|boludo\w*|pelotud\w*|forros?|mierda|gallinas?)\b/i;
const CTA = /link en (el )?perfil|link en (la )?bio|bocapresidente|jug[aá]lo|jug[aá] gratis|descarg[aá]/i;

// Devuelve los problemas del guion (vacío si está bien).
export function revisarGuion(g, { cta }) {
  const problemas = [];
  for (const t of [g.gancho, ...g.lineas, g.caption, g.comentario_fijado, ...g.hashtags]) {
    const m = String(t).match(PROHIBIDO);
    if (m) problemas.push(`dice "${m[0]}" (${t})`);
  }
  if (!cta) {
    for (const t of [g.gancho, ...g.lineas, g.caption, g.comentario_fijado]) {
      const m = String(t).match(CTA);
      if (m) problemas.push(`es un video sin invitación a jugar y dice "${m[0]}" (${t})`);
    }
  }
  return problemas;
}

// Deja el guion prolijo y dentro de los límites, venga de Claude o de un archivo escrito a mano.
export function limpiarGuion(g) {
  const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  // los emojis no se ven con la fuente de los subtítulos
  const sinEmojis = (v) => texto(String(v ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ''));
  const lineas = (Array.isArray(g.lineas) ? g.lineas : []).map(sinEmojis).filter(Boolean).slice(0, 10);
  if (lineas.length === 0) throw new Error('El guion no tiene frases en "lineas".');
  return {
    titulo: texto(g.titulo) || lineas[0],
    gancho: sinEmojis(g.gancho) || lineas[0],
    lineas,
    caption: texto(g.caption),
    hashtags: (Array.isArray(g.hashtags) ? g.hashtags : [])
      .map((h) => texto(h).replace(/^#+/, '').replace(/\s+/g, '').toLowerCase())
      .filter(Boolean)
      .slice(0, 5),
    comentario_fijado: texto(g.comentario_fijado),
  };
}

function pedirGuion(pedido, config, opciones) {
  const cliente = new Anthropic();
  return cliente.beta.messages.create({
    model: config.claude.modelo,
    max_tokens: 16000,
    // Si el modelo rechaza el pedido, la API lo reintenta sola con el modelo de respaldo recomendado.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: config.claude.esfuerzo,
      format: { type: 'json_schema', schema: ESQUEMA },
    },
    system: sistema(opciones),
    messages: [{ role: 'user', content: pedido }],
  });
}

export async function generarGuion({ formato, tema, datos, config, cta = true, vozPropia = true }) {
  const pedido = [
    `Formato: ${formato.nombre}. ${formato.idea}`,
    tema ? `Tema del día (actualidad): ${tema}` : null,
    datos ? `Datos reales que podés usar (no inventes otros):\n${JSON.stringify(datos)}` : null,
    'Escribí el guion.',
  ]
    .filter(Boolean)
    .join('\n\n');

  // Si el guion no pasa la revisión, se pide una vez más diciendo qué estuvo mal.
  let aviso = '';
  for (let intento = 1; ; intento++) {
    let respuesta;
    try {
      respuesta = await pedirGuion(pedido + aviso, config, { cta, vozPropia });
    } catch (e) {
      if (e instanceof Anthropic.APIError && e.status !== 401) throw e;
      throw new Error(`No pude usar la API de Claude (${e.message}). ¿Configuraste ANTHROPIC_API_KEY? También podés pasar un guion propio con --guion.`);
    }

    if (respuesta.stop_reason === 'refusal') {
      throw new Error(`Claude no quiso escribir este guion (${respuesta.stop_details?.category ?? 'sin categoría'}). Probá con otro tema.`);
    }
    if (respuesta.stop_reason === 'max_tokens') throw new Error('El guion quedó cortado. Probá de nuevo.');
    const texto = respuesta.content.find((b) => b.type === 'text')?.text;
    if (!texto) throw new Error('Claude no devolvió el guion.');
    const guion = limpiarGuion(JSON.parse(texto));
    const problemas = revisarGuion(guion, { cta });
    if (!problemas.length) return guion;
    if (intento === 2) throw new Error(`El guion no pasó la revisión: ${problemas.join('; ')}`);
    aviso = `\n\nEl guion anterior no sirvió porque ${problemas.join('; ')}. Escribilo de nuevo sin eso.`;
  }
}
