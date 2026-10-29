// Datos reales para que los guiones hablen de cosas que pasaron de verdad (--datos auto):
//   1. del juego: la foto real de la semana que trae (tablas, Boca, próximo partido, lesionados, noticias) y el
//      desafío de la semana;
//   2. del ranking público del juego en Supabase: solo números (puntajes, títulos, partidos). Nunca nombres ni usuarios.
// Todo es lectura: el navegador frena cualquier envío (ver grabar.mjs) y Supabase se consulta con la clave pública
// del juego, la misma que usa el sitio.
import { abrirJuego, ejecutarPaso } from './grabar.mjs';

const sinGrabar = { grabar() {}, cortar() {} };

async function leerDelJuego(url) {
  const { navegador, pagina } = await abrirJuego(url);
  try {
    await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ejecutarPaso(pagina, { accion: 'empezar', inicio: 'hoy' }, sinGrabar);
    return await pagina.evaluate(() => {
      const quePaso = (f) => {
        try {
          return f();
        } catch {
          return undefined;
        }
      };
      const s = state.standing || {};
      const calendario = (state.calendar || []).slice(0, 4).map((f) => ({
        rival: f.rival,
        competencia: f.comp || f.cup || 'liga',
        enDias: f.diaAbs - state.daysPassed,
      }));
      const zona = quePaso(() =>
        (state.liveTablas.zonaA || [])
          .slice()
          .sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga))
          .slice(0, 5)
          .map((t) => ({ equipo: t.name, pts: t.pts, pj: t.played })),
      );
      const desafio = quePaso(() => {
        const c = semana72();
        const P = plantillaSemanal72(c);
        return { clave: c, semana: +c.slice(6), titulo: P.tit, situacion: P.txt, objetivoExtra: P.obj };
      });
      return {
        fotoReal: state.dataSnapshot,
        boca: { zona: 'A', posicion: s.pos, pts: s.pts, pj: s.played, pg: s.wins, pe: s.draws, pp: s.losses, gf: s.gf, gc: s.ga },
        zonaA: zona,
        proximosPartidos: calendario,
        lesionados: (state.plantel || [])
          .filter((p) => /^Lesionado/.test(p.estado || ''))
          .map((p) => ({ jugador: p.name, dias: p.diasRestantes }))
          .slice(0, 6),
        // solo las noticias de la foto real (llevan la fuente); las demás las inventa el juego
        noticiasReales: (state.news || [])
          .map((n) => String(n.text || '').replace(/\s+/g, ' ').trim())
          .filter((t) => /\(fuente:/i.test(t))
          .slice(0, 8),
        desafioDeLaSemana: desafio,
        supabase: quePaso(() => ({ url: BOCA_ONLINE.supabaseUrl, clave: BOCA_ONLINE.supabaseClave })),
      };
    });
  } finally {
    await navegador.close();
  }
}

async function consultar(sb, ruta, contar = false) {
  const r = await fetch(`${sb.url}/rest/v1/${ruta}`, {
    headers: { apikey: sb.clave, Authorization: `Bearer ${sb.clave}`, ...(contar ? { Prefer: 'count=exact', Range: '0-0' } : {}) },
  });
  if (!r.ok) throw new Error(`Supabase respondió ${r.status} en ${ruta.split('?')[0]}`);
  const filas = await r.json();
  const total = contar ? Number((r.headers.get('content-range') || '').split('/')[1]) : undefined;
  return { filas, total };
}

// Solo columnas sin datos personales: nunca "nombre" ni "usuario".
async function leerDeSupabase(sb, semanaClave) {
  const hace7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const cols = 'puntaje,titulos,temporadas,pj,pg,terminada,detalle';
  const mejor = await consultar(sb, `gestiones?select=${cols}&desafio=is.null&actualizado=gte.${hace7}&order=puntaje.desc&limit=1`, true);
  const g = mejor.filas[0];
  const out = {
    gestionesDeLaSemana: mejor.total || 0,
    mejorGestionDeLaSemana: g
      ? {
          puntaje: g.puntaje,
          temporadas: g.temporadas,
          partidos: g.pj,
          ganados: g.pg,
          titulos: Array.isArray(g.detalle?.titulos) ? g.detalle.titulos.slice(0, 8) : g.titulos,
        }
      : null,
  };
  if (semanaClave) {
    const d = await consultar(sb, `ranking_desafios?select=puntaje,pj,pg,terminada&desafio=eq.${semanaClave}&order=puntaje.desc&limit=3`, true);
    out.desafioDeLaSemana = { participantes: d.total || 0, mejoresPuntajes: d.filas.map((f) => f.puntaje) };
  }
  return out;
}

export async function leerDatos({ url }) {
  const datos = { nota: 'Datos reales. Usá solo estos; si un número es chico, contalo como lo que es (el juego es nuevo).' };
  let sb = null;
  try {
    const j = await leerDelJuego(url);
    sb = j.supabase;
    delete j.supabase;
    datos.delJuego = j;
  } catch (e) {
    console.warn(`  (no pude leer los datos del juego: ${e.message.split('\n')[0]})`);
  }
  if (sb?.url && sb?.clave) {
    try {
      datos.rankingDeJugadores = await leerDeSupabase(sb, datos.delJuego?.desafioDeLaSemana?.clave);
    } catch (e) {
      console.warn(`  (no pude leer el ranking: ${e.message})`);
    }
  }
  return datos.delJuego || datos.rankingDeJugadores ? datos : undefined;
}
