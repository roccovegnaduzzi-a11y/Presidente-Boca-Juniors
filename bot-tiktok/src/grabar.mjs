import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { correr } from './util.mjs';

// Anuncios y estadísticas: las visitas del bot no son de personas reales y no tienen que contar como impresiones
// de anuncios (eso puede hacer que suspendan la cuenta de anuncios) ni como visitas del sitio (Cloudflare Web Analytics).
const BLOQUEADOS = /(googlesyndication|doubleclick|googleadservices|adservice\.google|googletagmanager|google-analytics|adnxs|taboola|outbrain|facebook\.net|clarity\.ms|cloudflareinsights|amplitude)/;
// Pagos y donaciones: Mercado Pago no se abre nunca.
const PAGOS = /(mercadopago|mercadolibre|mpago\.la)/;
// Botones que el bot no toca nunca, aunque un paso de config.json lo pida: pagos, donaciones y anuncios.
export const NUNCA_TOCAR = /\bol(Donar|DonarMP|SinAnuncios|YaPague|VerAnuncio|Pagar|CobrarPremio)\b|donar|donaci|chorip|sin anuncios|mercado ?pago|\bpagar\b|ya pagu/i;
// Opciones de una decisión que el bot no elige (terminarían la gestión).
const NO_ELEGIR = /renun|dimit/i;

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Espera hasta que una expresión del juego dé verdadero. Se evalúa desde afuera (por el protocolo de Chrome),
// así funciona aunque el sitio no permita eval (política de seguridad).
async function hastaQue(pagina, expresion, timeout = 30000) {
  const fin = Date.now() + timeout;
  for (;;) {
    try {
      if (await pagina.evaluate(expresion)) return true;
    } catch {
      // la página todavía está cargando
    }
    if (Date.now() > fin) return false;
    await pausa(250);
  }
}

// Toca un botón, salvo que sea de pagos o donaciones.
async function tocar(pagina, objetivo, timeout = 5000) {
  const loc = typeof objetivo === 'string' ? pagina.locator(objetivo).first() : objetivo;
  await loc.waitFor({ state: 'visible', timeout });
  const quien = await loc.evaluate((e) => {
    const b = e.closest('button, a, [data-action]') || e;
    return [b.getAttribute('data-action'), b.getAttribute('href'), b.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  });
  if (NUNCA_TOCAR.test(quien)) throw new Error(`No toco este botón (pagos o donaciones): "${quien.slice(0, 60)}"`);
  await loc.click({ timeout });
}

async function tocarSiHay(pagina, selector) {
  const loc = pagina.locator(selector).first();
  if (!(await loc.isVisible().catch(() => false))) return false;
  await tocar(pagina, loc);
  return true;
}

// Resuelve las decisiones abiertas tocando la primera opción que no termine la gestión.
async function resolverDecisiones(pagina, max = 4) {
  let n = 0;
  for (; n < max; n++) {
    await pausa(700); // que termine la animación de entrada
    // si la decisión está abierta en un cartel, se toca ahí (la copia del Resumen queda tapada por el cartel)
    let ops = pagina.locator('#modalRoot .ev59-op, #modalRoot [data-action=resolveEvent]');
    // (con el partido, la sala o las elecciones abiertas, la del Resumen queda tapada: no se toca)
    const tapado = await pagina.locator('#vivo, #sala, #el47, #campeon, #evolucion').count();
    if (!(await ops.count()) && !tapado) ops = pagina.locator('#main .ev59-op, #main [data-action=resolveEvent]');
    const textos = await ops.allTextContents();
    const i = textos.findIndex((t) => !NO_ELEGIR.test(t));
    if (i < 0) break;
    await tocar(pagina, ops.nth(i));
    await pausa(900);
  }
  return n;
}

// Primer ingreso de un jugador nuevo: portada → modo → asistente del presidente → asunción → promesa →
// tutorial (se saltea) → primera decisión. Sirve para la portada liviana de la v76 (#bpEntrar) y para la anterior.
async function empezarGestion(pagina, paso) {
  const t = paso.timeout ?? 120000;
  await hastaQue(pagina, `!!(document.getElementById('bpEntrar') || document.querySelector('.portada-btn') || document.getElementById('np62'))`, t);
  // hasta la v75, una decisión podía aparecer encima de la portada o de la elección del modo: se deja para después
  await pausa(1500);
  await tocarSiHay(pagina, '#modalRoot [data-action=modalCancel]');
  if (!(await tocarSiHay(pagina, '#bpEntrar'))) await tocarSiHay(pagina, '.portada-btn');
  if (!(await hastaQue(pagina, `!!document.getElementById('np62')`, t))) throw new Error('El juego no llegó a la elección del modo.');
  await pausa(900);
  await tocarSiHay(pagina, '#modalRoot [data-action=modalCancel]');
  await tocarSiHay(pagina, `#np62 [data-action=np62Elegir][data-id="${paso.modo ?? 'clasica'}"]`);
  await pausa(300);
  if (paso.inicio) await tocarSiHay(pagina, `#np62 [data-action=np72Inicio][data-id="${paso.inicio}"]`);
  await pausa(300);
  await tocar(pagina, '[data-action=np62Confirmar]');
  await pausa(1200);
  // el asistente del presidente: nombre, cara, perfil y asumir
  const nombre = pagina.locator('#presidentNameInput');
  if (await nombre.isVisible().catch(() => false)) await nombre.fill(paso.nombre ?? 'Presi de la Ribera');
  for (let i = 0; i < 8; i++) {
    if (await tocarSiHay(pagina, '[data-action=pz60Asumir]')) break;
    await tocarSiHay(pagina, '[data-action=pz60Perfil]');
    if (!(await tocarSiHay(pagina, '.pz60-sig'))) break;
    await pausa(800);
  }
  // en "Enero 2027" el juego simula lo que falta de 2026 y muestra el balance de la temporada
  await pausa(1500);
  await hastaQue(pagina, `!document.getElementById('ff72')`, 240000);
  await tocarSiHay(pagina, 'button:has-text("Empezar la temporada")');
  // la promesa de campaña (no aparece en todos los modos)
  if (await hastaQue(pagina, `!!document.querySelector('#modalRoot .ev59-modal')`, 20000)) {
    await resolverDecisiones(pagina, 1);
  }
  // después llegan el tutorial (se saltea) y la primera decisión: se resuelve lo que aparezca hasta que no
  // quede nada encima durante unos segundos
  for (let tranquilo = 0, i = 0; tranquilo < 4 && i < 40; i++) {
    await pausa(900);
    const algo =
      (await tocarSiHay(pagina, '[data-action=tut72Fin]')) ||
      (await tocarSiHay(pagina, 'button:has-text("Empezar la temporada")')) ||
      (await resolverDecisiones(pagina, 1)) > 0;
    tranquilo = algo ? 0 : tranquilo + 1;
  }
  // la lista de "Primeros pasos" del Resumen no hace falta en el video
  await tocarSiHay(pagina, '[data-action=pp72Ocultar]');
  // que hayan llegado todas las partes del juego (estadio, sala, partido en vivo...)
  await hastaQue(pagina, `!window.__partes76 || window.__partes76.listas`, 60000);
  await pagina.evaluate(() => window.scrollTo(0, 0));
}

// Llega hasta el próximo partido en vivo (avanza los días y resuelve las decisiones que aparezcan).
async function irAlPartido(pagina) {
  await tocarSiHay(pagina, `nav.tabs [data-action=switchTab][data-id="resumen"]`);
  for (let i = 0; i < 30; i++) {
    if (await pagina.locator('#vivo').count()) return;
    await resolverDecisiones(pagina, 2);
    await tocarSiHay(pagina, '.cta');
    await pausa(1500);
    if (!(await pagina.locator('#vivo').count())) await tocarSiHay(pagina, '#modalRoot [data-action=modalCancel]');
  }
  throw new Error('No llegué a ningún partido en vivo.');
}

// Juega el partido en vivo: hasta el final, durante unos segundos o hasta un minuto del reloj ("hastaMinuto").
// Se puede llamar varias veces seguidas con "cortar" en el medio para mostrar solo el principio y el final.
async function jugarPartido(pagina, paso) {
  if (await tocarSiHay(pagina, '#vivo [data-action=vivoEmpezar]')) await pausa(1200);
  const velocidades = pagina.locator('#vivo [data-action=velocidadVivo]');
  const n = await velocidades.count();
  if (n && paso.velocidad !== 'igual') {
    const i = paso.velocidad === 'max' || paso.velocidad == null ? n - 1 : Math.min(n - 1, paso.velocidad);
    if (await velocidades.nth(i).isVisible().catch(() => false)) await tocar(pagina, velocidades.nth(i));
  }
  const fin = Date.now() + (paso.segundos ?? 240) * 1000;
  while (Date.now() < fin) {
    await pausa(400);
    const e = await pagina.evaluate(() => {
      const r = document.getElementById('tvReloj');
      const t = r ? r.textContent : '';
      return {
        listo: typeof vivo === 'undefined' || !vivo || vivo.terminado || !document.getElementById('vivo'),
        minuto: /entretiempo/i.test(t) ? 45 : parseInt(t, 10),
      };
    });
    if (e.listo || (paso.hastaMinuto && e.minuto >= paso.hastaMinuto)) break;
    await resolverDecisiones(pagina, 1);
  }
}

// Adelanta la gestión fuera de cámara con las mismas funciones del juego (como la prueba larga):
// pasa los días, simula los partidos y elige al azar en las decisiones (nunca renunciar).
async function adelantar(pagina, paso) {
  const hasta = { elecciones: !!paso.elecciones, libroAbierto: !!paso.libroAbierto, dias: paso.dias ?? 0, partidos: paso.partidos ?? 0 };
  const max = paso.maxPasos ?? 30000;
  const r = await pagina.evaluate(
    async ({ hasta, max }) => {
      const g = globalThis;
      for (const f of ['advanceDays', 'simulateMatch', 'resolveEvent', 'closeModal']) {
        if (typeof g[f] !== 'function') return { estado: `el juego cambió: no encuentro ${f}()` };
      }
      g.__penalesAuto = true; // las series de penales se patean solas
      const dia0 = state.daysPassed;
      let pj = 0;
      const listo = () => {
        if (state.institucional && state.institucional.gameOver) return 'fin de la gestión';
        if (hasta.elecciones && document.getElementById('el47')) return 'elecciones';
        if (hasta.libroAbierto && typeof mercadoAbierto62 === 'function' && mercadoAbierto62()) return 'libro de pases abierto';
        if (hasta.dias && state.daysPassed - dia0 >= hasta.dias) return 'días';
        if (hasta.partidos && pj >= hasta.partidos) return 'partidos';
        return null;
      };
      for (let i = 0; i < max; i++) {
        const r = listo();
        if (r) return { estado: r, dias: state.daysPassed - dia0, pj };
        if (state.pendingEvent) {
          const ev = state.pendingEvent;
          const ops = (ev.options || []).filter((o) => !/renun|dimit/i.test(o.id + ' ' + (o.label || '')));
          const o = ops.length ? ops[Math.floor(Math.random() * ops.length)] : null;
          try {
            resolveEvent(o ? o.id : undefined);
          } catch {
            state.pendingEvent = null;
          }
          if (state.pendingEvent === ev) state.pendingEvent = null;
          try {
            closeModal();
          } catch {}
        } else if ((state.daysUntilNextMatch || 0) > 0) advanceDays();
        else {
          simulateMatch();
          pj++;
        }
        document.querySelectorAll('.cel-ov, #celebracion, .gc-ov, #campeon, #evolucion').forEach((e) => e.remove()); // los festejos no se ven: se quitan
        if (i % 20 === 0) await new Promise((ok) => setTimeout(ok, 0));
      }
      return { estado: 'tope de pasos', dias: state.daysPassed - dia0, pj };
    },
    { hasta, max },
  );
  if (/el juego cambió/.test(r.estado)) throw new Error(r.estado);
  if (r.estado !== 'elecciones') {
    await pagina.evaluate(() => {
      try {
        closeModal();
        renderAll();
      } catch {}
      window.scrollTo(0, 0);
    });
  }
  console.log(`  adelanté ${r.dias} días y ${r.pj} partidos (${r.estado})`);
  return r;
}

export async function ejecutarPaso(pagina, paso, rec) {
  const espera = { timeout: paso.timeout ?? 5000 };
  try {
    switch (paso.accion) {
      case 'esperar':
        await pagina.waitForTimeout(paso.ms ?? 1000);
        break;
      case 'grabar': // lo que sigue sale en el video
        rec.grabar();
        break;
      case 'cortar': // lo que sigue no sale en el video
        rec.cortar();
        break;
      case 'click':
        if (paso.selector) await tocar(pagina, paso.selector, espera.timeout);
        else await tocar(pagina, pagina.getByText(paso.texto, { exact: false }).first(), espera.timeout);
        break;
      case 'tocar': {
        // coordenadas en la pantalla de 540x960
        const quien = await pagina.evaluate(({ x, y }) => {
          const e = document.elementFromPoint(x, y);
          const b = e && (e.closest('button, a, [data-action]') || e);
          return b ? [b.getAttribute('data-action'), b.getAttribute('href'), b.textContent].filter(Boolean).join(' ') : '';
        }, paso);
        if (NUNCA_TOCAR.test(quien)) throw new Error(`No toco este botón (pagos o donaciones): "${quien.slice(0, 60)}"`);
        await pagina.mouse.click(paso.x, paso.y);
        break;
      }
      case 'escribir':
        await pagina.locator(paso.selector).first().fill(paso.texto, espera);
        break;
      case 'tecla':
        await pagina.keyboard.press(paso.tecla);
        break;
      case 'hasta':
        if (!(await hastaQue(pagina, paso.js ?? `!!document.querySelector(${JSON.stringify(paso.selector)})`, paso.timeout ?? 30000))) {
          throw new Error(`No apareció ${paso.selector ?? paso.js}`);
        }
        break;
      case 'scroll': {
        // de a poquito, para que en el video se vea un desplazamiento suave
        const tramos = 20;
        for (let i = 0; i < tramos; i++) {
          await pagina.mouse.wheel(0, (paso.y ?? 400) / tramos);
          await pagina.waitForTimeout(25);
        }
        break;
      }
      case 'ver': // lleva un elemento al centro de la pantalla, con un desplazamiento suave
        await pagina
          .locator(paso.selector)
          .first()
          .evaluate((e, bloque) => e.scrollIntoView({ behavior: 'smooth', block: bloque }), paso.bloque ?? 'center');
        break;
      case 'arriba':
        await pagina.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        break;
      case 'pestana':
        await tocar(pagina, `nav.tabs [data-action=switchTab][data-id="${paso.id}"]`, espera.timeout);
        await pagina.evaluate(() => window.scrollTo(0, 0));
        break;
      case 'empezar':
        await empezarGestion(pagina, paso);
        break;
      case 'decisiones':
        await resolverDecisiones(pagina, paso.max ?? 4);
        break;
      case 'irAlPartido':
        await irAlPartido(pagina);
        break;
      case 'jugarPartido':
        await jugarPartido(pagina, paso);
        break;
      case 'adelantar':
        await adelantar(pagina, paso);
        break;
      case 'js': // una expresión del juego (por ejemplo, abrir una pantalla); tiene que dar verdadero
        if (NUNCA_TOCAR.test(paso.codigo)) throw new Error(`No corro este código (pagos o donaciones): ${paso.codigo.slice(0, 60)}`);
        if (!(await pagina.evaluate(paso.codigo))) throw new Error(`El código no dio verdadero: ${paso.codigo.slice(0, 60)}`);
        break;
      default:
        throw new Error(`Paso desconocido: ${paso.accion}`);
    }
  } catch (e) {
    if (!paso.opcional) {
      e.message = `Paso "${paso.accion} ${paso.texto ?? paso.selector ?? paso.id ?? ''}": ${e.message.split('\n')[0]}`;
      throw e;
    }
    console.warn(`  (salteo el paso opcional "${paso.accion} ${paso.texto ?? paso.selector ?? paso.id ?? ''}": ${e.message.split('\n')[0]})`);
  }
  if (paso.despues) await pagina.waitForTimeout(paso.despues);
}

// Las fotos reales de jugadores (Wikimedia Commons) tienen licencia libre, pero piden nombrar al autor, cosa que en un
// video no se puede, y a veces se ven marcas en la ropa. En la grabación se cambian por una silueta (el juego no cambia).
// Hasta la v75 había un aviso de cookies abajo de todo: en la grabación no se muestra (no se acepta nada).
const SIN_AVISO = '#ck72{display:none!important}';
const SIN_FOTOS = `.foto-u{background-image:radial-gradient(circle at 50% 36%,rgba(255,255,255,.42) 0 17%,transparent 18%),radial-gradient(ellipse 46% 34% at 50% 100%,rgba(255,255,255,.42) 0 99%,transparent 100%)!important;background-color:rgba(10,30,80,.55)!important}`;

// Abre el navegador como un celular (540x960 con pantalla de doble densidad) y frena todo lo que no sea leer:
// envíos al servidor (ranking, cuentas, muro, sugerencias, errores), pagos, anuncios y estadísticas.
export async function abrirJuego(url, { ocultarFotosReales = true } = {}) {
  // Sin este flag, Chrome sin ventana manda el screencast a 540x960 aunque la pantalla sea de doble densidad.
  // BOT_NAVEGADOR=msedge usa el Edge instalado en Windows en vez del Chromium de Playwright.
  const navegador = await chromium.launch({ channel: process.env.BOT_NAVEGADOR || undefined, args: ['--force-device-scale-factor=2'] });
  const contexto = await navegador.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    serviceWorkers: 'block', // así todos los pedidos pasan por el filtro de abajo
  });
  {
    await contexto.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
      });
    }, SIN_AVISO + (ocultarFotosReales ? SIN_FOTOS : ''));
  }
  const pagina = await contexto.newPage();
  const frenados = [];
  const origen = new URL(url).origin;
  await pagina.route('**/*', (ruta) => {
    const pedido = ruta.request();
    let destino;
    try {
      destino = new URL(pedido.url());
    } catch {
      return ruta.continue();
    }
    const motivo = BLOQUEADOS.test(destino.hostname)
      ? 'estadísticas o anuncios'
      : PAGOS.test(destino.hostname)
        ? 'pagos'
        : destino.pathname.startsWith('/functions/v1/')
          ? 'funciones del servidor'
          : !['GET', 'HEAD'].includes(pedido.method())
            ? 'envío al servidor'
            : pedido.isNavigationRequest() && pedido.frame() === pagina.mainFrame() && destino.origin !== origen
              ? 'salir del juego'
              : null;
    if (motivo) {
      frenados.push(`${motivo}: ${pedido.method()} ${destino.hostname}${destino.pathname}`.slice(0, 120));
      return ruta.abort();
    }
    return ruta.continue();
  });
  pagina.on('popup', (p) => p.close());
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  return { navegador, contexto, pagina, frenados, errores };
}

// Graba el recorrido a 1080x1920 con el screencast de Chrome (la grabación de Playwright sale chica y con poca
// calidad). Los pasos "cortar" y "grabar" dejan afuera lo que no tiene que salir (el arranque, una simulación).
// Devuelve el video y cuántos segundos quedaron grabados.
export async function grabarJuego({ url, recorrido, segundos, carpeta, ocultarFotosReales }) {
  const dirCuadros = path.join(carpeta, 'cuadros');
  await mkdir(dirCuadros, { recursive: true });
  const { navegador, contexto, pagina, frenados, errores } = await abrirJuego(url, { ocultarFotosReales });

  // Chrome manda un cuadro cada vez que la pantalla cambia, con la hora exacta.
  const cuadros = [];
  const tramos = [];
  const escrituras = [];
  let ultimo = null;
  const guardar = (data, t) => {
    const archivo = path.join(dirCuadros, `c${String(cuadros.length).padStart(5, '0')}.jpg`);
    cuadros.push({ archivo, t, tramo: tramos.length - 1 });
    escrituras.push(writeFile(archivo, Buffer.from(data, 'base64')));
  };
  const rec = {
    grabando: false,
    grabar() {
      if (this.grabando) return;
      const t = Date.now() / 1000;
      tramos.push({ desde: t, hasta: null });
      this.grabando = true;
      if (ultimo) guardar(ultimo.data, t); // si la pantalla no cambia, Chrome no manda cuadros nuevos
    },
    cortar() {
      if (!this.grabando) return;
      this.grabando = false;
      tramos.at(-1).hasta = Date.now() / 1000;
    },
    grabado: () => tramos.reduce((s, x) => s + ((x.hasta ?? Date.now() / 1000) - x.desde), 0),
  };
  const cdp = await contexto.newCDPSession(pagina);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    ultimo = { data, t: metadata.timestamp };
    if (rec.grabando) guardar(data, metadata.timestamp);
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  try {
    await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1080, maxHeight: 1920 });
    await pagina.waitForTimeout(recorrido.esperaInicial ?? 1500);
    // si el recorrido no dice "cortar" al principio, se graba desde el arranque (como antes)
    if (recorrido.pasos?.[0]?.accion !== 'cortar') rec.grabar();
    try {
      for (const paso of recorrido.pasos ?? []) await ejecutarPaso(pagina, paso, rec);
    } catch (e) {
      await pagina.screenshot({ path: path.join(carpeta, 'error.png') }).catch(() => {});
      e.message += ` (captura de la pantalla: ${path.join(carpeta, 'error.png')})`;
      throw e;
    }
    rec.grabar();
    const falta = (segundos + 0.5 - rec.grabado()) * 1000;
    if (falta > 0) await pagina.waitForTimeout(falta);
    rec.cortar();
    await cdp.send('Page.stopScreencast');
  } finally {
    await navegador.close();
  }
  await Promise.all(escrituras);
  if (frenados.length) console.log(`  frenados (no salieron del navegador): ${[...new Set(frenados)].slice(0, 8).join(' · ')}`);
  if (errores.length) console.warn(`  errores del juego durante la grabación: ${errores.slice(0, 3).join(' / ')}`);

  // Cada cuadro dura hasta que llega el siguiente del mismo tramo (si la pantalla no cambia, Chrome no manda
  // cuadros nuevos); el último, hasta que termina el tramo.
  if (cuadros.length === 0) throw new Error('No se grabó ningún cuadro del juego.');
  const lineas = [];
  cuadros.forEach((c, i) => {
    const tramo = tramos[c.tramo];
    const sig = cuadros[i + 1];
    const fin = sig && sig.tramo === c.tramo ? sig.t : tramo.hasta;
    const dur = fin - Math.max(c.t, tramo.desde);
    if (dur > 0.001) lineas.push(`file '${path.basename(c.archivo)}'\nduration ${dur.toFixed(3)}`);
  });
  lineas.push(`file '${path.basename(cuadros.at(-1).archivo)}'`);
  await writeFile(path.join(dirCuadros, 'lista.txt'), lineas.join('\n'));

  const video = path.join(carpeta, 'grabacion.mp4');
  await correr(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', video],
    { cwd: dirCuadros },
  );
  if (!process.env.BOT_GUARDAR_CUADROS) await rm(dirCuadros, { recursive: true, force: true });
  return { video, desde: 0, duracion: rec.grabado(), frenados };
}
