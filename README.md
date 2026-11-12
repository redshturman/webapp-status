# Webapp Status

Panel mínimo de disponibilidad HTTP: JavaScript, HTML y CSS, sin base de datos, cuentas, históricos ni frontend compilado. Puedes ejecutarlo con **Node.js/Docker** en tu red o con **Cloudflare Workers** sin servidor propio. Node no necesita dependencias de ejecución; Wrangler es una herramienta de desarrollo opcional para Workers. Una fila por servicio con estado, código HTTP o error breve, tiempo de respuesta y última comprobación. El repositorio solo contiene destinos de ejemplo.

## Arranque local

Requiere Node.js 20 o posterior. No hace falta ejecutar `npm install`.

1. Copia `config.example.json` a `config.json` (`cp` en Linux; `Copy-Item` en PowerShell).
2. Edita los nombres, URLs y códigos HTTP aceptados.
3. Ejecuta `npm start` y abre <http://localhost:3000>.

`CONFIG_PATH` permite usar otro archivo y `PORT` cambia el puerto (3000 por defecto). El proceso escucha en todas las interfaces. Una configuración inválida o ausente impide el arranque y muestra un error. Se lee al arrancar: reinicia el proceso o contenedor después de editarla. `config.json` está excluido de Git; no subas URLs corporativas ni secretos.

## Configuración

```json
{
  "ui": {
    "title": "Estado de servicios"
  },
  "intervalSeconds": 30,
  "timeoutSeconds": 5,
  "services": [
    {
      "name": "Portal",
      "url": "https://example.com/",
      "acceptedStatusCodes": [200]
    }
  ]
}
```

Los valores por defecto son 30 segundos, 5 segundos y `[200]`, respectivamente. Debe haber al menos un servicio, con nombre único y URL HTTP/HTTPS sin usuario, contraseña ni fragmento. Los tiempos deben ser enteros positivos. Solo el operador elige los destinos desde este archivo: el navegador no puede añadir URLs ni lanzar comprobaciones arbitrarias.

`ui.title` configura el único título de la pantalla y el de la pestaña. Debe ser un texto no vacío y se muestra como texto, nunca como HTML. Puedes omitir `ui` o `title`: se mantiene el valor predeterminado del ejemplo. El antiguo campo `ui.eyebrow` se ignora para que las configuraciones existentes sigan funcionando; puedes eliminarlo. Reinicia después de cambiar la configuración.

En Node/Docker, la primera ronda empieza al arrancar, con estado **Pendiente** hasta obtener un resultado. Se comprueban los servicios en paralelo con una petición GET y un límite total por solicitud que incluye DNS y TLS. Se mide hasta recibir las cabeceras; no se descarga ni inspecciona el cuerpo completo. La siguiente ronda comienza 30 segundos después de terminar la anterior (hasta unos 35 segundos entre inicios con la configuración por defecto). La página obtiene los últimos resultados cada 5 segundos; si pierde contacto con el panel, indica que los resultados son antiguos. Workers funciona bajo demanda, como se explica más abajo.

## Qué significa el estado

**Disponible** significa únicamente que se recibió un código HTTP configurado como aceptado **desde el servidor que ejecuta este panel**. No prueba las funciones completas, el inicio de sesión, las dependencias, el navegador del usuario ni la causa raíz de un fallo. El tiempo mostrado incluye resolución y establecimiento de conexión hasta las cabeceras, no la carga completa de la página.

**No disponible** distingue código HTTP no aceptado, fallo DNS, tiempo agotado, fallo TLS y otros errores de conexión. El texto y el color indican el resultado; no se depende únicamente del color.

La columna **Detalle** muestra el código HTTP y una descripción breve cuando se conoce (por ejemplo, `200 · OK`, `302 · Redirección` o `401 · Requiere autenticación`); otros códigos se muestran sin descripción. La etiqueta no cambia la disponibilidad, que depende de `acceptedStatusCodes`, ni presupone SSO o salud de la aplicación. Sin respuesta muestra un error breve: tiempo agotado, DNS, TLS o conexión; mientras espera, indica pendiente. Las explicaciones ampliadas siguen disponibles en la API. La pantalla no incluye notas técnicas ni mensajes normales de conexión: solo aparece un aviso discreto si falla la actualización, marcando los resultados anteriores como desactualizados hasta recuperarse.

Las redirecciones **no se siguen**. Un 301/302 puede apuntar a SSO y no demostrar que la aplicación original funciona. Por defecto es rojo; aceptar explícitamente ese código solo confirma que responde con esa redirección. Un **401** significa que el servidor pide autenticación, no necesariamente que esté caído: añádelo a `acceptedStatusCodes` si esa respuesta es la esperada. Aceptarlo tampoco comprueba credenciales ni funcionalidad. Es preferible una URL de salud sin efectos secundarios, acordada con el propietario del servicio.

## Docker

Un único contenedor, también sobre una VM pequeña Alpine o Ubuntu con Docker. Desde el directorio del repositorio, después de crear `config.json`:

```sh
docker build -t webapp-status .
docker run -d --name webapp-status --restart unless-stopped \
  -p 3000:3000 \
  --mount type=bind,src="$(pwd)/config.json",dst=/app/config.json,readonly \
  webapp-status
```

Equivalente en PowerShell:

```powershell
docker build -t webapp-status .
docker run -d --name webapp-status --restart unless-stopped -p 3000:3000 --mount "type=bind,src=$((Get-Location).Path)\config.json,dst=/app/config.json,readonly" webapp-status
```

El archivo montado debe poder leerlo el usuario no privilegiado `node` del contenedor. Consulta la salida con `docker logs webapp-status`. Abre el puerto de la VM solo a la red prevista y permite que el contenedor resuelva y alcance los destinos corporativos. `localhost` dentro del contenedor es el propio contenedor, no la VM.

### Certificados corporativos

La validación TLS permanece habilitada. Si la organización utiliza una CA privada, monta su certificado público en formato PEM y configura el mecanismo estándar de Node **`NODE_EXTRA_CA_CERTS`**:

```sh
docker run -d --name webapp-status --restart unless-stopped \
  -p 3000:3000 \
  --mount type=bind,src="$(pwd)/config.json",dst=/app/config.json,readonly \
  --mount type=bind,src="/ruta/ca-corporativa.pem",dst=/certs/ca.pem,readonly \
  -e NODE_EXTRA_CA_CERTS=/certs/ca.pem \
  webapp-status
```

En local, establece esa misma variable antes de arrancar Node. Reinicia tras cambiar la CA. No uses `NODE_TLS_REJECT_UNAUTHORIZED=0`. No se incorporan claves privadas ni certificados al contenedor. Esta versión usa conexiones directas: no implementa proxy HTTP, credenciales, cookies ni inicio de sesión SSO.

### Alcance del despliegue

En Node/Docker, el panel no tiene autenticación ni HTTPS entrante: está pensado para una red interna controlada. Si necesitas acceso restringido o TLS para los visitantes, colócalo detrás del proxy inverso de tu organización y aplica sus reglas de acceso. Los nombres, estados y errores son visibles a quien alcance el puerto; las URLs de destino no se publican en la API. No lo expongas directamente a Internet.

## Cloudflare Workers (sin servidor propio)

Esta opción despliega **assets y backend** juntos: `src/worker.js` responde a `/api/status` y sirve el mismo HTML/CSS/JS mediante el binding `ASSETS`. Subir solo la carpeta `public` deja esa API sin implementar y provoca el error HTTP 404. No necesitas una VM, contenedor, base de datos ni tareas programadas.

### Preparar y probar

Requiere **Node.js 22.12 o posterior** para la herramienta oficial Wrangler (recomendado Node.js 24 LTS). El servidor Node anterior sigue funcionando con Node.js 20 o posterior.

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
npm run workers:dev
```

En PowerShell, usa `Copy-Item wrangler.example.jsonc wrangler.jsonc` en lugar de `cp`. Abre la dirección local que muestra Wrangler (normalmente <http://localhost:8787>) y comprueba también <http://localhost:8787/api/status>. `--local` ejecuta el runtime de Workers en tu equipo, sin desplegar recursos; las peticiones de comprobación sí se envían a los destinos configurados.

Edita `wrangler.jsonc`:

- `name`: nombre del Worker que quieres crear o actualizar. Para actualizar uno existente, usa exactamente su nombre.
- `vars.STATUS_CONFIG`: objeto con la misma estructura que `config.json` (`ui.title`, `intervalSeconds`, `timeoutSeconds`, `services`). Puedes copiar ahí el contenido de tu configuración, usando únicamente destinos que puedan alcanzarse desde Cloudflare.

`wrangler.jsonc` está excluido de Git. No copies configuraciones privadas al ejemplo versionado ni a `public`. En Workers no se lee el archivo local `config.json` ni se monta un volumen: la configuración se incluye como binding JSON al desplegar. No pongas secretos en ella; no se envían credenciales o cookies del visitante a los destinos. Modifica el archivo local y vuelve a desplegar para aplicar cambios.

### Desplegar

Desde el repositorio completo y con tu cuenta Cloudflare:

```sh
npx wrangler login
npx wrangler whoami
npm run workers:deploy
```

Wrangler pide autorización en el navegador; confirma la cuenta correcta antes de desplegar. El comando publica tanto el Worker como los assets y devuelve su URL real `workers.dev`. No despliegues únicamente `public`. Para revisar el bundle sin publicar recursos puedes ejecutar `npx wrangler deploy --dry-run`. Este proyecto no configura despliegue automático ni contiene credenciales de Cloudflare.

### Diferencias y límites

En Workers, cada **GET a `/api/status` realiza una ronda real de comprobaciones** y responde con sus resultados. No hay proceso residente, `setInterval`, caché compartida ni comprobaciones cuando no hay visitantes. La página espera `intervalSeconds` después de terminar cada ronda (30 s por defecto), en lugar de consultar resultados cada 5 s como en Node. Cada visitante realiza sus propias rondas; llamadas manuales a la API también realizan comprobaciones. La primera respuesta puede tardar hasta el timeout configurado; no se muestra disponibilidad ficticia mientras llega.

Esta integración mínima admite **hasta 6 servicios** por ronda y `timeoutSeconds` entre **1 y 8 segundos** (5 por defecto): respeta el límite de conexiones simultáneas de Workers y deja margen al timeout de 10 s del navegador. Una configuración que exceda esos límites devuelve 500 y registra el motivo, no resultados inventados. Consulta los [límites y cuotas de tu plan](https://developers.cloudflare.com/workers/platform/limits/); cada ronda consume una petición al Worker y hasta una subpetición por servicio. Para muchos visitantes, restringe el acceso o aplica límites de tráfico con las herramientas de Cloudflare.

Se conservan GET, códigos aceptados, redirecciones **sin seguir**, timeout y validación TLS del runtime. Los errores que la plataforma exponga con un código DNS/TLS se clasifican como tales; si `fetch` solo informa un fallo genérico, se muestra **Error de conexión**, sin adivinar la causa. Si Cloudflare responde con su propio código HTTP de error, se muestra ese código. Los resultados se miden desde Cloudflare, no desde tu red ni el navegador.

**Workers no obtiene acceso a VPN, DNS interno ni CA privadas por desplegar el panel.** `NODE_EXTRA_CA_CERTS` solo aplica al modo Node/Docker y no configura la confianza TLS del `fetch` de Workers. El modo local puede alcanzar destinos de tu equipo que el despliegue remoto no podrá alcanzar. Para servicios internos o con CA corporativa, conserva Node/Docker dentro de esa red. No desactives TLS ni publiques un proxy abierto para sortear esas restricciones.

Cloudflare proporciona HTTPS entrante, pero el panel sigue sin autenticación propia. En una URL pública, cualquiera con acceso verá nombres y estados y podrá activar rondas sobre los destinos fijos. Usa ejemplos públicos para una demo; para restringir visitas, configura Cloudflare Access y las políticas de tu organización antes de publicar datos internos.

## Pruebas

Ejecuta `npm test`. Las pruebas de Node, UI y lógica Workers usan servidores locales o respuestas controladas, sin requerir destinos corporativos ni acceso a Internet. Para probar además el runtime real de Workers, ejecuta `npm run workers:dev` como se indica arriba.
