# Webapp Status

Panel mínimo de disponibilidad HTTP: Node.js + JavaScript, HTML y CSS, sin dependencias npm, base de datos, cuentas, históricos ni frontend compilado. Una fila por servicio con estado, código HTTP o error breve, tiempo de respuesta y última comprobación. Reutilizable en cualquier red; el repositorio solo contiene destinos de ejemplo.

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
    "eyebrow": "DISPONIBILIDAD HTTP",
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

`ui.eyebrow` configura el texto pequeño sobre la cabecera y `ui.title` el título principal y de la pestaña. Ambos deben ser textos no vacíos y se muestran como texto, nunca como HTML. Puedes omitir `ui` o cualquiera de sus campos: se mantienen los valores predeterminados del ejemplo, sin modificar configuraciones existentes. Reinicia después de cambiarlos.

La primera ronda empieza al arrancar, con estado **Pendiente** hasta obtener un resultado. Se comprueban los servicios en paralelo con una petición GET y un límite total por solicitud que incluye DNS y TLS. Se mide hasta recibir las cabeceras; no se descarga ni inspecciona el cuerpo completo. La siguiente ronda comienza 30 segundos después de terminar la anterior (hasta unos 35 segundos entre inicios con la configuración por defecto). La página obtiene los últimos resultados cada 5 segundos; si pierde contacto con el panel, indica que los resultados son antiguos.

## Qué significa el estado

**Disponible** significa únicamente que se recibió un código HTTP configurado como aceptado **desde el servidor que ejecuta este panel**. No prueba las funciones completas, el inicio de sesión, las dependencias, el navegador del usuario ni la causa raíz de un fallo. El tiempo mostrado incluye resolución y establecimiento de conexión hasta las cabeceras, no la carga completa de la página.

**No disponible** distingue código HTTP no aceptado, fallo DNS, tiempo agotado, fallo TLS y otros errores de conexión. El texto y el color indican el resultado; no se depende únicamente del color.

La columna **Detalle** muestra solo el código cuando hay respuesta HTTP (por ejemplo, `200` o `301`). Sin respuesta muestra un error breve: tiempo agotado, DNS, TLS o conexión; mientras espera, indica pendiente. Las explicaciones ampliadas siguen disponibles en la API. La pantalla no incluye notas técnicas ni mensajes normales de conexión: solo aparece un aviso discreto si falla la actualización, marcando los resultados anteriores como desactualizados hasta recuperarse.

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

El panel no tiene autenticación ni HTTPS entrante: está pensado para una red interna controlada. Si necesitas acceso restringido o TLS para los visitantes, colócalo detrás del proxy inverso de tu organización y aplica sus reglas de acceso. Los nombres, estados y errores son visibles a quien alcance el puerto; las URLs de destino no se publican en la API. No lo expongas directamente a Internet.

## Pruebas

Ejecuta `npm test`. Las pruebas usan servidores locales, sin requerir destinos corporativos ni acceso a Internet.
