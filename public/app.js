const table = document.querySelector('#services');
const connection = document.querySelector('#connection');
const states = { up: 'Disponible', down: 'No disponible', pending: 'Pendiente' };
const details = {
  pending: 'Pendiente',
  timeout: 'Tiempo agotado',
  dns: 'Error DNS',
  tls: 'Error TLS',
  connection: 'Error de conexión'
};
const httpDetails = {
  200: 'OK',
  201: 'Creado',
  202: 'Aceptado',
  204: 'Sin contenido',
  301: 'Redirección',
  302: 'Redirección',
  303: 'Redirección',
  304: 'Sin cambios',
  307: 'Redirección',
  308: 'Redirección',
  400: 'Solicitud incorrecta',
  401: 'Requiere autenticación',
  403: 'Acceso denegado',
  404: 'No encontrado',
  405: 'Método no permitido',
  408: 'Tiempo agotado',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
  502: 'Error de puerta de enlace',
  503: 'Servicio no disponible',
  504: 'Tiempo de espera agotado'
};

function render(data) {
  document.querySelector('#title').textContent = data.ui.title;
  document.title = data.ui.title;
  const rows = data.services.map(service => {
    const row = document.createElement('tr');
    const code = service.statusCode;
    const detail = code === null ? details[service.category] :
      httpDetails[code] ? `${code} · ${httpDetails[code]}` : String(code);
    const values = [
      service.name,
      states[service.state],
      detail,
      service.responseTimeMs === null ? '—' : `${service.responseTimeMs} ms`,
      service.checkedAt === null ? '—' : new Date(service.checkedAt).toLocaleString()
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 1) {
        const badge = document.createElement('span');
        badge.className = `badge ${service.state}`;
        badge.textContent = value;
        cell.replaceChildren(badge);
      }
      row.append(cell);
    });
    return row;
  });
  table.replaceChildren(...rows);
}

async function refresh() {
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
    table.classList.remove('stale');
    connection.hidden = true;
    connection.textContent = '';
  } catch (error) {
    connection.className = 'error';
    connection.hidden = false;
    connection.textContent = `No se puede actualizar (${error.message}). Los resultados mostrados están desactualizados.`;
    table.classList.add('stale');
  } finally {
    setTimeout(refresh, 5000);
  }
}

refresh();
