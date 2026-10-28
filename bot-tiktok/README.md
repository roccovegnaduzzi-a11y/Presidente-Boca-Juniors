# Bot de TikTok de Boca Presidente

Arma videos verticales del juego listos para TikTok y los manda a tu cuenta.

1. **Guion**: Claude escribe el gancho, la voz en off, la descripción, los hashtags y una pregunta para fijar en los comentarios. Los formatos están en [`ideas.json`](ideas.json).
2. **Voz**: Azure la lee con acento argentino (`es-AR-TomasNeural`), frase por frase, para que los subtítulos queden sincronizados.
3. **Imagen**: Chromium abre [bocapresidente.com](https://bocapresidente.com) como si fuera un celular, sigue los pasos de [`config.json`](config.json) y graba la pantalla a 1080×1920. También podés pasarle tu propia grabación.
4. **Edición** (ffmpeg): recorta a 9:16, agrega el gancho arriba, subtítulos karaoke en amarillo, la marca, una placa final con la dirección del juego, música opcional que baja sola cuando habla la voz y volumen normalizado.
5. **TikTok**: lo deja como archivo, lo manda a tus borradores o lo publica directo.

## Probarlo sin cuentas

Necesitás Node 20 o más nuevo y ffmpeg.

```bash
cd bot-tiktok
npm install
npx playwright install chromium
npm run prueba
```

El resultado queda en `salida/<fecha>/video.mp4`. La prueba usa un guion de ejemplo, ninguna voz y una pantalla falsa (`ejemplos/juego-de-prueba.html`).

## Uso

```bash
node src/main.mjs                                    # guion con Claude + grabación → archivo
node src/main.mjs --modo borrador                    # …y lo manda a tus borradores de TikTok
node src/main.mjs --tema "Boca perdió el clásico"    # reacciona a la noticia del día
node src/main.mjs --video mi-grabacion.mp4           # usa tu propia grabación del celu
node src/main.mjs --guion mi-guion.json --voz ninguna
```

| Opción | Qué hace |
|---|---|
| `--modo archivo\|borrador\|directo` | Qué hacer con el video (por defecto, `archivo`) |
| `--formato <id>` | Formato de `ideas.json`. Si no lo pasás, rota uno por día |
| `--tema <texto>` | Noticia o tema del día para reaccionar |
| `--video <archivo>` | Tu grabación (cualquier tamaño: se recorta a vertical) |
| `--guion <json>` | Guion escrito a mano (mismo formato que `ejemplos/guion-ejemplo.json`) |
| `--datos <json>` | Datos reales del juego que Claude puede mencionar |
| `--musica <mp3>` | Música de fondo. **Solo música con derechos de uso** |
| `--voz azure\|ninguna` | Sin voz, quedan solo los subtítulos |
| `--url <dirección>` | Grabar otra dirección (por ejemplo, una página de prueba) |

## Cuentas que necesitás

| Para qué | Servicio | Variables |
|---|---|---|
| Guiones | API de Claude ([console.anthropic.com](https://console.anthropic.com)) | `ANTHROPIC_API_KEY` |
| Voz | Azure Speech ([portal.azure.com](https://portal.azure.com), recurso "Speech", tiene plan gratis) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Subir a TikTok | [TikTok for Developers](https://developers.tiktok.com) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| Guardar el permiso de TikTok | El Supabase del juego (opcional) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

Si sos menor de edad, estas cuentas (sobre todo las que cobran) tienen que estar a nombre de un adulto responsable.

## Conectar TikTok

1. En [developers.tiktok.com](https://developers.tiktok.com), creá una app web. Te va a pedir ícono, descripción y links a los términos y la política de privacidad del juego.
2. Agregale **Login Kit** y **Content Posting API**. En Login Kit, cargá como *Redirect URI* `https://bocapresidente.com/`.
3. Mientras TikTok no apruebe la app, usala en modo *Sandbox* con tu cuenta de TikTok como usuario de prueba (lo que pida el panel).
4. Copiá el *Client key* y el *Client secret*, y conectá tu cuenta una sola vez:

   ```bash
   export TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=...
   npm run autorizar
   ```

   Abrí el link, aceptá y pegá la dirección a la que te manda TikTok (`https://bocapresidente.com/?code=...`).
   - Si tenés `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` configuradas, el permiso se guarda en la tabla privada `ajustes` y el bot lo renueva solo.
   - Si no, queda en `.tokens.json`. Para GitHub Actions, copiá el `refresh_token` de ese archivo al secreto `TIKTOK_REFRESH_TOKEN`.

### Borrador o directo

- **Borrador** (recomendado, permiso `video.upload`): el video te llega como notificación en la app de TikTok. Le ponés un **sonido en tendencia** bajito, lo revisás y publicás. La API no puede agregar los sonidos de TikTok, y con este paso además controlás cada video antes de que salga.
- **Directo** (permiso `video.publish`, agregalo con `TIKTOK_SCOPES=user.info.basic,video.upload,video.publish npm run autorizar`): publica sin tocar el celular. Hasta que TikTok audite la app, **solo publica en cuentas privadas**. La auditoría tarda semanas y es para apps que sirven a muchos usuarios.

## Automático con GitHub Actions

El workflow [`.github/workflows/bot-tiktok.yml`](../.github/workflows/bot-tiktok.yml) arma un video los lunes, miércoles y viernes a las 18:17 (hora argentina) y lo manda a tus borradores.

1. En GitHub: **Settings → Secrets and variables → Actions** y cargá las variables de la tabla de arriba como secretos.
2. Para hacer uno al toque (por ejemplo, después de un partido): **Actions → Bot de TikTok → Run workflow**, escribí el tema y elegí el modo. Se puede hacer desde el celular.
3. Cada ejecución guarda el video, la portada y la descripción en **Artifacts** durante 14 días.

Sin las claves de TikTok, el bot igual arma el video y lo deja para descargar. Sin la clave de Azure, lo arma sin voz.

## Ajustar la grabación al juego

Los pasos de `config.json` → `juego.pasos` dicen qué tocar mientras se graba. **Los que vienen de ejemplo se armaron sin ver el juego**: cambialos por los botones reales para que el video muestre lo que querés.


| Acción | Campos | Ejemplo |
|---|---|---|
| `esperar` | `ms` | `{ "accion": "esperar", "ms": 2000 }` |
| `click` | `texto` o `selector` | `{ "accion": "click", "texto": "Mercado de pases" }` |
| `tocar` | `x`, `y` (pantalla de 540×960) | `{ "accion": "tocar", "x": 270, "y": 800 }` |
| `escribir` | `selector`, `texto` | `{ "accion": "escribir", "selector": "#nombre", "texto": "Presidente" }` |
| `tecla` | `tecla` | `{ "accion": "tecla", "tecla": "Enter" }` |
| `scroll` | `y` (negativo sube) | `{ "accion": "scroll", "y": 800 }` |

Todos aceptan `"opcional": true` (si no encuentra el botón, sigue) y `"despues": <ms>` (pausa después del paso). Para encontrar los selectores, grabá tus clics con:

```bash
npx playwright codegen --device="Pixel 7" https://bocapresidente.com
```

La grabación no sale del juego: si un paso intenta ir a otra página (por ejemplo, la de pago), la bloquea. También bloquea anuncios y estadísticas, para que las visitas del bot no cuenten como impresiones de anuncios ni ensucien tus métricas.

## Reglas para no tener problemas

- Activá la etiqueta **"Contenido generado con IA"** cuando la voz sea de Azure. En modo directo, el bot la manda sola.
- Como el video promociona tu propio juego, activá la divulgación de **contenido promocional → tu marca**. En modo directo, el bot la manda sola (`marcaPropia` en `config.json`).
- No uses el escudo ni fotos oficiales del club, ni música sin derechos.
- La API permite alrededor de 15 publicaciones por día por cuenta. Con una por día alcanza y sobra.
