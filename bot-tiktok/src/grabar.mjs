import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { correr } from './util.mjs';

const BLOQUEADOS = /(googlesyndication|doubleclick|googleadservices|adservice\.google|googletagmanager|google-analytics|adnxs|taboola|outbrain|facebook\.net|clarity\.ms)/;

async function ejecutarPaso(pagina, paso) {
  const espera = { timeout: paso.timeout ?? 5000 };
  try {
    switch (paso.accion) {
      case 'esperar':
        await pagina.waitForTimeout(paso.ms ?? 1000);
        break;
      case 'click':
        if (paso.selector) await pagina.locator(paso.selector).first().click(espera);
        else await pagina.getByText(paso.texto, { exact: false }).first().click(espera);
        break;
      case 'tocar': // coordenadas en la pantalla de 540x960
        await pagina.mouse.click(paso.x, paso.y);
        break;
      case 'escribir':
        await pagina.locator(paso.selector).first().fill(paso.texto, espera);
        break;
      case 'tecla':
        await pagina.keyboard.press(paso.tecla);
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
      default:
        throw new Error(`Paso desconocido: ${paso.accion}`);
    }
  } catch (e) {
    if (!paso.opcional) throw e;
    console.warn(`  (salteo el paso opcional "${paso.accion} ${paso.texto ?? paso.selector ?? ''}")`);
  }
  if (paso.despues) await pagina.waitForTimeout(paso.despues);
}

// Abre el juego en un celular simulado (540x960 con pantalla de doble densidad), sigue los pasos
// de config.json y graba la pantalla a 1080x1920. Usa el screencast de Chrome en vez de la grabación
// de Playwright, que sale chica y con poca calidad.
export async function grabarJuego({ url, juego, segundos, carpeta }) {
  const dirCuadros = path.join(carpeta, 'cuadros');
  await mkdir(dirCuadros, { recursive: true });

  // Sin este flag, Chrome sin ventana manda el screencast a 540x960 aunque la pantalla sea de doble densidad.
  const navegador = await chromium.launch({ args: ['--force-device-scale-factor=2'] });
  const contexto = await navegador.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-AR',
  });
  const pagina = await contexto.newPage();

  // Que la grabación no se vaya del juego (por ejemplo, a la página de pago) ni abra pestañas.
  // También bloquea anuncios y estadísticas: las visitas del bot no son de personas reales y no
  // tienen que contar como impresiones de anuncios (eso puede hacer que suspendan la cuenta de anuncios).
  const origen = new URL(url).origin;
  await pagina.route('**/*', (ruta) => {
    const pedido = ruta.request();
    const destino = new URL(pedido.url());
    if (BLOQUEADOS.test(destino.hostname)) return ruta.abort();
    if (pedido.isNavigationRequest() && pedido.frame() === pagina.mainFrame() && destino.origin !== origen) {
      return ruta.abort();
    }
    return ruta.continue();
  });
  pagina.on('popup', (p) => p.close());

  // Chrome manda un cuadro cada vez que la pantalla cambia, con la hora exacta.
  const cuadros = [];
  const escrituras = [];
  let grabando = true;
  const cdp = await contexto.newCDPSession(pagina);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    if (grabando) {
      const archivo = path.join(dirCuadros, `c${String(cuadros.length).padStart(5, '0')}.jpg`);
      cuadros.push({ archivo, t: metadata.timestamp });
      escrituras.push(writeFile(archivo, Buffer.from(data, 'base64')));
    }
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  let desde;
  let hasta;
  try {
    await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1080, maxHeight: 1920 });
    await pagina.waitForTimeout(juego.esperaInicial ?? 3000);
    desde = Date.now() / 1000; // lo anterior es la pantalla de carga
    for (const paso of juego.pasos ?? []) await ejecutarPaso(pagina, paso);
    const falta = (desde + segundos + 0.5) * 1000 - Date.now();
    if (falta > 0) await pagina.waitForTimeout(falta);
    hasta = Date.now() / 1000;
    grabando = false;
    await cdp.send('Page.stopScreencast');
  } finally {
    await navegador.close();
  }
  await Promise.all(escrituras);

  // Arranca en el último cuadro anterior a "desde". Cada cuadro dura hasta que llega el
  // siguiente (si la pantalla no cambia, Chrome no manda cuadros nuevos).
  if (cuadros.length === 0) throw new Error('No se grabó ningún cuadro del juego.');
  const primero = Math.max(0, cuadros.findLastIndex((c) => c.t <= desde));
  const usar = cuadros.slice(primero);
  const lineas = usar.map((c, i) => {
    const fin = usar[i + 1]?.t ?? hasta;
    const inicio = Math.max(c.t, desde);
    return `file '${path.basename(c.archivo)}'\nduration ${Math.max(0.001, fin - inicio).toFixed(3)}`;
  });
  lineas.push(`file '${path.basename(usar.at(-1).archivo)}'`);
  await writeFile(path.join(dirCuadros, 'lista.txt'), lineas.join('\n'));

  const video = path.join(carpeta, 'grabacion.mp4');
  await correr(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', video],
    { cwd: dirCuadros },
  );
  await rm(dirCuadros, { recursive: true, force: true });
  return { video, desde: 0 };
}
