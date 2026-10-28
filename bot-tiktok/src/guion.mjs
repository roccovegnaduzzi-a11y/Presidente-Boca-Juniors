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

const SISTEMA = `Escribís guiones de TikTok para "Boca Presidente" (bocapresidente.com), un juego web gratis hecho por hinchas donde sos presidente de Boca: armás el plantel, manejás la plata y buscás la Séptima Libertadores.

Los videos muestran el juego en pantalla, con voz en off y subtítulos. La voz es la de un hincha argentino: voseo, humor futbolero, cargadas sanas.

Reglas:
- "lineas": de 6 a 9 frases de 3 a 9 palabras cada una. En total, entre 18 y 28 segundos hablados.
- La primera frase es el gancho hablado: tiene que frenar el scroll en 2 segundos.
- La última frase invita a jugar con "link en el perfil". No digas la dirección web: aparece escrita en pantalla.
- "gancho": texto en pantalla de hasta 8 palabras. Puede complementar la primera frase en vez de repetirla.
- "caption": arrancá con lo que alguien buscaría en TikTok (por ejemplo "Juego de Boca" o "Simulador de presidente de Boca"). Máximo 150 caracteres, sin hashtags.
- "hashtags": de 3 a 5, en minúscula y sin el símbolo #.
- "comentario_fijado": una pregunta que invite a comentar o a votar.
- Sin emojis en "gancho" ni en "lineas" (se dibujan sobre el video). En "caption" y "comentario_fijado" sí podés usarlos.
- Lo que pasa en el juego se cuenta como algo del juego. No inventes estadísticas, resultados ni declaraciones reales.
- No digas que es el juego oficial del club ni hables mal de personas reales.
- Nada de insultos, violencia, barras, discriminación ni apuestas.`;

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

function pedirGuion(pedido, config) {
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
    system: SISTEMA,
    messages: [{ role: 'user', content: pedido }],
  });
}

export async function generarGuion({ formato, tema, datos, config }) {
  const pedido = [
    `Formato: ${formato.nombre}. ${formato.idea}`,
    tema ? `Tema del día (actualidad): ${tema}` : null,
    datos ? `Datos reales del juego que podés usar (no inventes otros):\n${JSON.stringify(datos)}` : null,
    'Escribí el guion.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let respuesta;
  try {
    respuesta = await pedirGuion(pedido, config);
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
  return limpiarGuion(JSON.parse(texto));
}
