const adminList = document.getElementById('admin-list');

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function fetchWorks() {
  const res = await fetch('/api/admin/works');
  if (res.status === 401) {
    window.location.assign('/admin/login');
    throw new Error('La sesión terminó. Iniciá sesión nuevamente.');
  }
  const data = await res.json();
  return data.works || [];
}

function renderStats(works) {
  const total = works.length;
  const pending = works.filter((item) => item.status === 'pending').length;
  const approved = works.filter((item) => item.status === 'approved').length;
  const rejected = works.filter((item) => item.status === 'rejected').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-approved').textContent = approved;
  document.getElementById('stat-rejected').textContent = rejected;
}

function renderWorks(works) {
  if (!works.length) {
    adminList.innerHTML = '<div class="empty-state">No hay obras aún.</div>';
    return;
  }

  adminList.innerHTML = works.map((work) => `
    <article class="work-row">
      <div class="work-thumb-wrap">
        <img src="${escapeHTML(work.image_url || 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=900&q=80')}" alt="Obra: ${escapeHTML(work.title)}" />
      </div>
      <div class="work-body">
        <div class="work-meta-top">
          <div>
            <h3>${escapeHTML(work.title)}</h3>
            <p>${escapeHTML(work.author)}</p>
          </div>
          <span class="status status-${escapeHTML(work.status)}">${escapeHTML(work.status)}</span>
        </div>
        <p><strong>Tema:</strong> ${escapeHTML(work.theme)}</p>
        <p><strong>Estado comercial:</strong> ${escapeHTML(work.commercial_status)}</p>
        <p><strong>Email:</strong> ${escapeHTML(work.email || '—')}</p>
        <p><strong>WhatsApp:</strong> ${escapeHTML(work.whatsapp || '—')}</p>
        <p><strong>Descripción:</strong> ${escapeHTML(work.description || 'Sin descripción')}</p>
        <div class="work-actions">
          <button data-id="${work.id}" data-status="approved" class="action-btn approve-btn">Aprobar</button>
          <button data-id="${work.id}" data-status="rejected" class="action-btn reject-btn">Rechazar</button>
          <button data-id="${work.id}" data-status="pending" class="action-btn pending-btn">Pendiente</button>
          <button data-id="${work.id}" class="action-btn delete-btn danger">Eliminar</button>
        </div>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('.approve-btn, .reject-btn, .pending-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const status = btn.dataset.status;
      await updateStatus(id, status);
    });
  });

  document.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('¿Eliminar esta obra?')) return;
      await deleteWork(id);
    });
  });
}

async function updateStatus(id, status) {
  const res = await fetch(`/api/works/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.message || 'No se pudo actualizar el estado.');
    return;
  }

  if (data.googleSheets?.enabled && !data.googleSheets.ok) {
    alert('El estado se actualizó en el sitio, pero Google Sheets no confirmó la sincronización.');
  }

  const works = await fetchWorks();
  renderStats(works);
  renderWorks(works);
}

async function deleteWork(id) {
  const res = await fetch(`/api/works/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || 'No se pudo eliminar.');
    return;
  }

  if (data.googleSheets?.enabled && !data.googleSheets.ok) {
    alert(data.message || 'Se eliminó del sitio, pero falló el borrado en Google Sheets.');
  }

  const works = await fetchWorks();
  renderStats(works);
  renderWorks(works);
}

async function init() {
  try {
    const works = await fetchWorks();
    renderStats(works);
    renderWorks(works);
  } catch (error) {
    adminList.innerHTML = '<div class="empty-state">No se pudieron cargar las obras. Comprueba que el servidor esté activo.</div>';
  }
}

document.getElementById('admin-logout')?.addEventListener('click', async () => {
  await fetch('/api/admin/session', { method: 'DELETE' });
  window.location.assign('/admin/login');
});

init();
