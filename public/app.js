const table = document.querySelector('#services');
const connection = document.querySelector('#connection');
const cadence = document.querySelector('#cadence');
const states = { up: 'Disponible', down: 'No disponible', pending: 'Pendiente' };

function render(data) {
  const rows = data.services.map(service => {
    const row = document.createElement('tr');
    const values = [
      service.name,
      states[service.state],
      service.explanation,
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
  cadence.textContent = `Nueva ronda ${data.intervalSeconds} s después de terminar la anterior. Tiempo máximo por solicitud: ${data.timeoutSeconds} s.`;
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
    connection.className = '';
    connection.textContent = `Panel conectado · actualizado a las ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    connection.className = 'error';
    connection.textContent = `No se puede actualizar el panel (${error.message}). Los resultados anteriores, si aparecen, están desactualizados.`;
    table.classList.add('stale');
  } finally {
    setTimeout(refresh, 5000);
  }
}

refresh();
