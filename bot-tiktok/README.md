# Bot de TikTok de Boca Presidente

Arma videos verticales del juego listos para TikTok y los manda a los borradores de tu cuenta.

1. **Datos reales** (`--datos auto`, lo que se usa por defecto): abre el juego y lee la foto real de la semana (tablas, Boca, próximo partido, lesionados, noticias) y el desafío de la semana. Del ranking público de Supabase lee solo números (la mejor gestión de la semana, cuántos jugaron el desafío). Nunca nombres ni usuarios.
2. **Guion**: Claude escribe el gancho, las frases, la descripción, los hashtags y una pregunta para fijar en los comentarios, con esos datos. Los formatos están en [`ideas.json`](ideas.json). Hay formatos que invitan a jugar y otros de **pura opinión de hincha**, sin "link en el perfil". Cada guion se revisa (insultos, barras, apuestas, publicidad en los de opinión) y, si no pasa, se pide de nuevo.
3. **Voz**: por defecto **ninguna**. El video sale en silencio, con los subtítulos a un ritmo cómodo para leer, y vos grabás tu voz encima desde el editor de TikTok. Si querés, Azure la lee con acento argentino (`--voz azure`).
4. **Imagen**: Chromium abre [bocapresidente.com/jugar](https://bocapresidente.com/jugar/) como si fuera un celular, sigue un **recorrido** de [`config.json`](config.json) según el formato (tabla, plantel, mercado, partido, fin de mandato, desafío) y graba la pantalla a 1080×1920. Lo que no tiene que salir (el arranque de la partida, una simulación de un año) se graba fuera de cámara.
5. **Edición** (ffmpeg): gancho arriba, subtítulos karaoke en amarillo, la marca y una placa final (solo en los videos que invitan a jugar), música opcional y volumen normalizado. También saca la portada y una **hoja de zonas** (`zonas.jpg`) para controlar que nada quede tapado por los botones de TikTok.
6. **TikTok**: lo deja como archivo, lo manda a tus borradores o lo publica directo.

## Probarlo

Necesitás Node 20 o más nuevo y [ffmpeg](https://ffmpeg.org/download.html) (con `ffmpeg` y `ffprobe` en el PATH, o en la carpeta que digas con `FFMPEG_DIR`).

```bash
cd bot-tiktok
npm install
npx playwright install chromium
npm run prueba        # pantalla falsa, sin cuentas
npm run prueba-real   # el juego de verdad, con un guion de opinión escrito a mano
npm run datos         # muestra los datos reales que vería Claude
```

En Windows podés usar el Edge que ya tenés en vez de bajar Chromium, y sacar los videos de OneDrive:

```powershell
$env:BOT_NAVEGADOR = "msedge"; $env:BOT_FUENTE = "Verdana"; $env:BOT_SALIDA = "$HOME\.boca-presidente\bot-salida"
npm run prueba-real
```

(`BOT_FUENTE=Verdana` porque Windows no trae la letra DejaVu Sans que usa GitHub; tienen la misma forma.)

El resultado queda en `salida/<fecha>/`: `video.mp4`, `portada.jpg`, `zonas.jpg`, `descripcion.txt`, `para-leer.txt` (las frases con el segundo en que aparecen), `guion.json` y `datos.json`.

## Uso

```bash
node src/main.mjs                                       # datos reales + guion con Claude + grabación → archivo
node src/main.mjs --modo borrador                       # …y lo manda a tus borradores de TikTok
node src/main.mjs --formato previa                      # la previa del próximo partido, sin invitar a jugar
node src/main.mjs --tema "Boca perdió el clásico" --cta no
node src/main.mjs --video mi-grabacion.mp4              # usa tu propia grabación del celu
```

| Opción | Qué hace |
|---|---|
| `--modo archivo\|borrador\|directo` | Qué hacer con el video (por defecto, `archivo`) |
| `--formato <id>` | Formato de `ideas.json`. Si no lo pasás, rota uno por día |
| `--tema <texto>` | Noticia o tema del día para reaccionar |
| `--cta si\|no` | Si el video invita a jugar. Por defecto, lo que diga el formato |
| `--recorrido <id>` | Qué parte del juego grabar. Por defecto, la del formato |
| `--datos auto\|ninguno\|<json>` | Datos reales para el guion (por defecto, `auto`) |
| `--voz ninguna\|azure` | Por defecto `ninguna`: grabás vos la voz en TikTok |
| `--video <archivo>` | Tu grabación (cualquier tamaño: se recorta a vertical) |
| `--guion <json>` | Guion escrito a mano (mismo formato que `ejemplos/guion-ejemplo.json`) |
| `--musica <mp3>` | Música de fondo. **Solo música con derechos de uso** |
| `--url <dirección>` | Grabar otra dirección (por ejemplo, el sitio en tu compu) |
| `--solo-datos` | Muestra los datos reales y termina |

## Formatos

| Formato | Recorrido | ¿Invita a jugar? |
|---|---|---|
| `septima` · Serie: intentando ganar la Séptima | partido | sí |
| `vendo-o-banco` · ¿Lo vendo o lo banco? | mercado | sí |
| `peor-presidente` · El peor presidente de la historia | fin-de-mandato | sí |
| `superclasico` · Ganarle a River | partido | sí |
| `mercado` · Armé el equipo con poca plata | mercado | sí |
| `desafio-semanal` · Desafío de la semana | desafio | sí |
| `opinion-tabla` · Opinión de hincha: cómo viene Boca | tabla | no |
| `previa` · La previa: qué equipo pondría | plantel | no |
| `reaccion` · Reacción de hincha | partido | no |
| `que-harias` · ¿Qué harías vos de presidente? (necesita `--tema`) | tabla | no |

Los videos sin invitación no llevan la marca ni la placa final, y el guion no puede decir "link en el perfil", "jugalo", "gratis" ni la dirección.

## Recorridos del juego

Están en `config.json` → `juego.recorridos`. Todos arrancan una gestión nueva fuera de cámara (portada, modo, asistente del presidente, promesa, tutorial y primera decisión) y después graban:

| Recorrido | Qué se ve |
|---|---|
| `tabla` | El Resumen, la Zona A real, la tabla anual y el calendario con el próximo partido |
| `plantel` | Las cartas del plantel, la formación y las estadísticas |
| `mercado` | Arranca en enero de 2027 y adelanta hasta que abre el libro de pases: el pedido del DT, la lista y la sala de negociación (dos propuestas) |
| `partido` | El próximo partido real de Boca en vivo: la previa, los primeros 30 minutos y el final |
| `fin-de-mandato` | La gestión adelantada fuera de cámara hasta las elecciones de diciembre de 2027: el escrutinio, el resultado y la imagen de la gestión |
| `desafio` | El desafío de la semana: la situación de arranque, el plantel, las finanzas y el primer partido |

Pasos que se pueden usar:

| Acción | Campos | Qué hace |
|---|---|---|
| `cortar` / `grabar` | | Lo que sigue no sale / sale en el video |
| `empezar` | `inicio` (`hoy` o `2027`), `modo` (`clasica`, `semanal72`, ...), `nombre` | Arranca una gestión nueva como un jugador nuevo |
| `pestana` | `id` (`resumen`, `plantel`, `tablas`, `mercado`, ...) | Abre una pestaña |
| `adelantar` | `elecciones`, `libroAbierto`, `dias` o `partidos` | Juega solo (fuera de cámara) hasta que pase eso. En las decisiones elige al azar, nunca renunciar |
| `irAlPartido` | | Avanza hasta el próximo partido en vivo |
| `jugarPartido` | `velocidad` (`max`, `igual` o un número), `hastaMinuto`, `segundos` | Juega el partido en vivo |
| `decisiones` | `max` | Toma las decisiones abiertas (la primera opción que no sea renunciar) |
| `click` | `texto` o `selector` | Toca un botón |
| `tocar` | `x`, `y` (pantalla de 540×960) | Toca un punto |
| `scroll`, `ver`, `arriba` | `y` / `selector` | Baja o sube la pantalla de a poco |
| `hasta` | `selector` o `js` | Espera a que aparezca algo |
| `esperar` | `ms` | Espera |
| `escribir`, `tecla`, `js` | | Escribe, aprieta una tecla o corre una expresión del juego |

Todos aceptan `"opcional": true` (si falla, sigue) y `"despues": <ms>`. Si un paso falla, queda una captura en `salida/<fecha>/error.png`. Un recorrido puede tener `"acelerarHasta"`: si la grabación dura más que las frases, el juego se acelera hasta esa cantidad de veces (por defecto 1,25) y lo que sobra se corta.

### Lo que la grabación no hace nunca

- **No manda nada al servidor**: frena todo lo que no sea leer (ranking, cuentas, muro, sugerencias, reportes de errores) y las funciones del servidor (pagos, borrar cuenta). Juega sin iniciar sesión.
- **No toca pagos ni donaciones**: si un paso quiere tocar "Invitá un choripán", "Sin anuncios", Mercado Pago o parecidos, el bot se frena con un error. Tampoco abre Mercado Pago ni sale del juego.
- **No cuenta como visita**: bloquea las estadísticas (Cloudflare Web Analytics) y los anuncios.
- **No muestra fotos reales**: las fotos de jugadores de Wikimedia Commons (licencia libre que pide nombrar al autor, cosa que en un video no se puede) se cambian por una silueta, solo en la grabación.

## Datos reales

`npm run datos` muestra lo mismo que recibe Claude. Sale de dos lugares, los dos de solo lectura:

- **El juego**: la foto real de la semana que trae cada partida nueva (fecha, posición y números de Boca, los 5 primeros de la Zona A, los próximos 4 partidos, lesionados, noticias reales) y el desafío de la semana (título, situación y objetivo).
- **El ranking público** (Supabase, con la clave pública del juego, la misma que usa el sitio): cuántas gestiones se jugaron en la semana, la mejor (puntaje, temporadas, partidos, títulos) y cuántos jugaron el desafío con los mejores puntajes. **Nunca** se leen las columnas `nombre` ni `usuario`.

Si algo falla (por ejemplo, el ranking no responde), el guion se escribe con lo que haya.

## Tu voz

Con `--voz ninguna` (lo de siempre), cada frase dura lo que tarda en leerse tranquila (2,3 palabras por segundo, con un respiro de 0,6 s entre frases; se ajusta en `config.json` → `voz.ritmoPropio`). En TikTok:

1. Abrí el borrador, tocá **Voz en off** (el micrófono) y grabá leyendo los subtítulos: el amarillo te marca el ritmo. `para-leer.txt` tiene las frases con el segundo en que aparece cada una.
2. Si querés, poné un **sonido en tendencia** bajito.
3. Decidí vos si corresponde el aviso de **contenido promocional** (el bot nunca lo activa).

## Zonas de TikTok

`zonas.jpg` muestra 6 cuadros del video con las zonas que tapa la app pintadas de rojo: arriba las pestañas, a la derecha la columna de botones y abajo el usuario, la descripción y el sonido. Los subtítulos, el gancho y la placa final están armados para quedar afuera de esas zonas. Para rehacerla: `npm run zonas -- salida/<fecha>`.

## Cuentas que necesitás

| Para qué | Servicio | Variables |
|---|---|---|
| Guiones | API de Claude ([console.anthropic.com](https://console.anthropic.com)) | `ANTHROPIC_API_KEY` |
| Subir a TikTok | [TikTok for Developers](https://developers.tiktok.com) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| Guardar el permiso de TikTok | El Supabase del juego (recomendado) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Voz sintética (opcional) | Azure Speech ([portal.azure.com](https://portal.azure.com), recurso "Speech", tiene plan gratis) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |

Si sos menor de edad, estas cuentas (sobre todo las que cobran) tienen que estar a nombre de un adulto responsable.

## Conectar TikTok

Tu cuenta sigue siendo personal: no hace falta pasarla a Business.

1. Entrá a [developers.tiktok.com](https://developers.tiktok.com) con tu cuenta de TikTok y creá una app (**Manage apps → Connect an app**). Tipo: web. Te pide ícono, nombre, descripción, categoría y los links a los términos y a la privacidad: `https://bocapresidente.com/aviso-legal/` y `https://bocapresidente.com/privacidad/`.
2. En **Products**, agregá **Login Kit** y **Content Posting API**. En Login Kit, en *Redirect URI*, cargá `https://bocapresidente.com/` (con la barra final).
3. En **Scopes**, dejá `user.info.basic` y `video.upload` (con eso alcanza para los borradores).
4. Arriba, pasá la app a **Sandbox**. En *Sandbox settings → Target users*, agregá tu cuenta de TikTok como usuario de prueba.
5. Copiá el **Client key** y el **Client secret** de la app.
6. En la compu, una sola vez:

   ```powershell
   cd bot-tiktok
   $env:TIKTOK_CLIENT_KEY = "..."; $env:TIKTOK_CLIENT_SECRET = "..."
   $env:SUPABASE_URL = "https://dognkjvuzlhtzhvvovbt.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY = "..."
   npm run autorizar
   ```

   Abrí el link que aparece, entrá con tu cuenta y aceptá. TikTok te manda a `https://bocapresidente.com/?code=...`: copiá esa dirección entera de la barra y pegala en la consola.
   - Con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, el permiso queda en la tabla privada `ajustes` (ningún jugador la puede leer) y el bot lo renueva solo.
   - Si no, queda en `.tokens.json`. Para GitHub Actions, copiá el `refresh_token` de ese archivo al secreto `TIKTOK_REFRESH_TOKEN` (dura un año).
7. Probá: `node src/main.mjs --modo borrador`. Te tiene que llegar una notificación en la app de TikTok.

### Borrador o directo

- **Borrador** (recomendado, permiso `video.upload`): el video te llega como notificación en la app de TikTok. Grabás tu voz, le ponés un sonido en tendencia, lo revisás y publicás. La API no puede agregar los sonidos de TikTok, y así controlás cada video antes de que salga.
- **Directo** (permiso `video.publish`): publica sin tocar el celular, pero hasta que TikTok audite la app **solo publica en privado**. La auditoría tarda semanas y es para apps que sirven a muchos usuarios: para tu cuenta, usá borradores.

## Automático con GitHub Actions

El workflow [`.github/workflows/bot-tiktok.yml`](../.github/workflows/bot-tiktok.yml) arma un video los lunes, miércoles y viernes a las 18:17 (hora argentina) y lo manda a tus borradores. GitHub solo corre los horarios programados desde la **rama principal** del repositorio, así que `bot-tiktok/` y `.github/workflows/bot-tiktok.yml` tienen que estar ahí.

1. En el repositorio de GitHub: **Settings → Secrets and variables → Actions → New repository secret**, y cargá uno por uno:
   - `ANTHROPIC_API_KEY`
   - `TIKTOK_CLIENT_KEY` y `TIKTOK_CLIENT_SECRET`
   - `SUPABASE_URL` (`https://dognkjvuzlhtzhvvovbt.supabase.co`) y `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API Keys → la clave secreta)
   - o, si no usás Supabase para el permiso, `TIKTOK_REFRESH_TOKEN`
   - solo si querés la voz sintética: `AZURE_SPEECH_KEY` y `AZURE_SPEECH_REGION`
2. Para hacer uno al toque (por ejemplo, después de un partido): **Actions → Bot de TikTok → Run workflow**. Ahí elegís el modo, el tema, el formato, si invita a jugar, el recorrido y la voz. Se puede hacer desde el celular.
3. Cada ejecución guarda el video, la portada, la hoja de zonas, la descripción, las frases para leer y los datos en **Artifacts** durante 14 días.

Sin las claves de TikTok, el bot igual arma el video y lo deja para descargar.

## Reglas para no tener problemas

- **Contenido promocional**: lo decidís vos en la app, video por video. El bot nunca lo activa (tampoco en modo directo).
- **Contenido generado con IA**: activalo cuando la voz sea de Azure. En modo directo, el bot lo manda solo; con tu voz no hace falta.
- Nada del escudo, fotos oficiales ni marcas del club. Los guiones no pueden tener insultos, violencia, barras ni apuestas.
- Música solo con derechos de uso (o los sonidos de TikTok, desde la app).
- La API permite alrededor de 15 publicaciones por día por cuenta. Con una por día alcanza y sobra.
