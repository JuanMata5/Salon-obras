const form = document.getElementById('art-form');
const statusText = document.getElementById('form-status');
const galleryFeed = document.getElementById('gallery-feed');
const votingFeed = document.getElementById('voting-feed');
const commercialFeed = document.getElementById('commercial-feed');
const imageDialog = document.getElementById('image-dialog');
const imageDialogContent = document.getElementById('image-dialog-content');
const imageDialogCaption = document.getElementById('image-dialog-caption');
const submissionDialog = document.getElementById('submission-dialog');
const submissionDialogTitle = document.getElementById('submission-dialog-title');
const submissionDialogMessage = document.getElementById('submission-dialog-message');
const fallbackImage = 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=900&q=80';
let approvedWorks = [];

document.querySelectorAll('.scroll-to-form').forEach((button) => {
  button.addEventListener('click', () => document.getElementById('art-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
});

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function categoriesFor(work) {
  if (Array.isArray(work.category)) return work.category.map((value) => String(value).trim()).filter(Boolean);
  const raw = String(work.category || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((value) => String(value).trim()).filter(Boolean);
  } catch {}
  return raw.split(';').map((value) => value.trim()).filter(Boolean);
}

function hasCommercialStatus(work, status) {
  const statuses = Array.isArray(work.commercial_status)
    ? work.commercial_status
    : String(work.commercial_status || '').split(/\s*;\s*/);
  return statuses.includes(status);
}

function matchesTheme(work, value) {
  return !value || String(work.theme || '').trim() === value || categoriesFor(work).includes(value);
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function searchableWorkText(work) {
  return normalizeSearchText([work.title, work.author, work.theme, ...categoriesFor(work), work.description]
    .filter(Boolean).join(' '));
}

function facetValuesFor(works) {
  return works.flatMap((work) => [work.theme, ...categoriesFor(work)]);
}

function sortWorks(works, sortBy) {
  return [...works].sort((a, b) => {
    if (sortBy === 'votes') return (b.votes || 0) - (a.votes || 0);
    if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '', 'es');
    if (sortBy === 'theme') return (a.theme || '').localeCompare(b.theme || '', 'es');
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function setOptions(selectId, values) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const selected = select.value;
  const options = values.map((value) => String(value || '').trim()).filter(Boolean);
  const uniqueValues = [...new Set(options)].sort((a, b) => a.localeCompare(b, 'es'));
  select.innerHTML = '<option value="">Todos</option>' + uniqueValues
    .map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
  if (uniqueValues.includes(selected)) select.value = selected;
}

function workCard(work, voting = false) {
  const voted = localStorage.getItem(`salon-vote-${work.id}`) === '1';
  const image = work.image_url || fallbackImage;
  const price = hasCommercialStatus(work, 'A la venta') && Number(work.price_amount) > 0 && ['ARS', 'USD', 'EUR'].includes(work.price_currency)
    ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: work.price_currency, maximumFractionDigits: 2 }).format(Number(work.price_amount))
    : '';
  return `<article class="gallery-card">
    <img class="expandable-image" src="${escapeHTML(image)}" alt="Obra: ${escapeHTML(work.title)}" aria-label="Ampliar obra: ${escapeHTML(work.title)}" aria-haspopup="dialog" role="button" tabindex="0" data-caption="${escapeHTML(`${work.title} · ${work.author}`)}" loading="lazy" />
    <div class="gallery-card-body">
      <h3>${escapeHTML(work.title)}</h3>
      <p>${escapeHTML(work.author)} · ${escapeHTML(work.theme)}</p>
      ${price ? `<p class="work-price">${escapeHTML(price)}</p>` : ''}
      ${work.description ? `<p>${escapeHTML(work.description)}</p>` : ''}
      ${voting ? `<p class="vote-count">${Number(work.votes) || 0} votos</p>
        <button class="action-btn vote-btn" data-id="${Number(work.id)}" ${voted ? 'disabled' : ''}>${voted ? 'Voto registrado' : 'Votar por esta obra'}</button>` : ''}
    </div>
  </article>`;
}

function renderGallery() {
  if (!galleryFeed) return;
  const query = normalizeSearchText(document.getElementById('gallery-search')?.value.trim());
  const theme = document.getElementById('gallery-theme')?.value || '';
  const sortBy = document.getElementById('gallery-sort')?.value || 'recent';
  const items = sortWorks(approvedWorks.filter((work) =>
    matchesTheme(work, theme) && searchableWorkText(work).includes(query)
  ), sortBy);
  galleryFeed.innerHTML = items.length ? items.map((work) => workCard(work)).join('') : '<div class="empty-state">No hay obras publicadas que coincidan con la búsqueda.</div>';
}

function renderCommercial() {
  if (!commercialFeed) return;
  const query = normalizeSearchText(document.getElementById('commercial-search')?.value.trim());
  const theme = document.getElementById('commercial-theme')?.value || '';
  const author = document.getElementById('commercial-author')?.value || '';
  const items = approvedWorks.filter((work) => hasCommercialStatus(work, 'A la venta') && matchesTheme(work, theme) && (!author || String(work.author || '').trim() === author) && searchableWorkText(work).includes(query));
  commercialFeed.innerHTML = items.length ? items.map((work) => workCard(work)).join('') : '<div class="empty-state">No hay obras disponibles para la venta.</div>';
}

function renderVoting() {
  if (!votingFeed) return;
  const period = document.getElementById('voting-period')?.value || 'open';
  const theme = document.getElementById('voting-theme')?.value || '';
  const author = document.getElementById('voting-author')?.value || '';
  const sortBy = document.getElementById('voting-sort')?.value || 'votes';
  if (period !== 'open') {
    votingFeed.innerHTML = `<div class="empty-state">${period === 'closed' ? 'La votación está cerrada.' : 'La votación todavía no comenzó.'}</div>`;
    return;
  }
  const items = sortWorks(approvedWorks.filter((work) => matchesTheme(work, theme) && (!author || String(work.author || '').trim() === author)), sortBy);
  votingFeed.innerHTML = items.length ? items.map((work) => workCard(work, true)).join('') : '<div class="empty-state">Todavía no hay obras aprobadas para votar.</div>';
  votingFeed.querySelectorAll('.vote-btn:not(:disabled)').forEach((button) => {
    button.addEventListener('click', () => voteForWork(button));
  });
}

function renderAll() {
  renderGallery();
  renderCommercial();
  renderVoting();
}

function openExpandedImage(image) {
  if (!imageDialog || !imageDialogContent) return;
  imageDialogContent.src = image.currentSrc || image.src;
  imageDialogContent.alt = image.alt;
  if (imageDialogCaption) imageDialogCaption.textContent = image.dataset.caption || image.alt;
  if (typeof imageDialog.showModal === 'function') imageDialog.showModal();
  else window.open(imageDialogContent.src, '_blank', 'noopener');
}

[galleryFeed, commercialFeed, votingFeed].filter(Boolean).forEach((feed) => {
  feed.addEventListener('click', (event) => {
    const image = event.target.closest('.expandable-image');
    if (image) openExpandedImage(image);
  });
  feed.addEventListener('keydown', (event) => {
    const image = event.target.closest('.expandable-image');
    if (image && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openExpandedImage(image);
    }
  });
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog')?.close());
});

imageDialog?.addEventListener('click', (event) => {
  if (event.target === imageDialog) imageDialog.close();
});

function showSubmissionDialog(title, message) {
  if (!submissionDialog) return;
  if (submissionDialogTitle) submissionDialogTitle.textContent = title;
  if (submissionDialogMessage) submissionDialogMessage.textContent = message;
  if (!submissionDialog.open && typeof submissionDialog.showModal === 'function') submissionDialog.showModal();
  else if (typeof submissionDialog.showModal !== 'function') window.alert(`${title}\n\n${message}`);
}

async function loadWorks() {
  try {
    const response = await fetch('/api/works');
    if (!response.ok) throw new Error('No se pudieron cargar las obras.');
    const data = await response.json();
    approvedWorks = (data.works || []).filter((work) => work.status === 'approved');
    const commercialWorks = approvedWorks.filter((work) => hasCommercialStatus(work, 'A la venta'));
    setOptions('gallery-theme', facetValuesFor(approvedWorks));
    setOptions('commercial-theme', facetValuesFor(commercialWorks));
    setOptions('voting-theme', facetValuesFor(approvedWorks));
    setOptions('commercial-author', commercialWorks.map((work) => work.author));
    setOptions('voting-author', approvedWorks.map((work) => work.author));
    renderAll();
  } catch (error) {
    [galleryFeed, commercialFeed, votingFeed].filter(Boolean).forEach((feed) => {
      feed.innerHTML = '<div class="empty-state">No se pudo conectar con el servidor.</div>';
    });
  }
}

async function voteForWork(button) {
  const id = button.dataset.id;
  if (localStorage.getItem(`salon-vote-${id}`) === '1') return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/works/${id}/vote`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'No se pudo registrar el voto.');
    localStorage.setItem(`salon-vote-${id}`, '1');
    const work = approvedWorks.find((item) => String(item.id) === String(id));
    if (work) work.votes = result.votes;
    renderVoting();
    if (result.googleSheets?.enabled && !result.googleSheets.ok) {
      const voteButton = votingFeed?.querySelector(`.vote-btn[data-id="${id}"]`);
      if (voteButton) voteButton.textContent = 'Voto guardado; Sheets no sincronizado';
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message;
  }
}

['gallery-search', 'commercial-search'].forEach((id) => document.getElementById(id)?.addEventListener('input', renderAll));
['gallery-theme', 'gallery-sort', 'commercial-theme', 'commercial-author', 'voting-period', 'voting-theme', 'voting-author', 'voting-sort']
  .forEach((id) => document.getElementById(id)?.addEventListener('change', renderAll));

const forSaleCheckbox = document.getElementById('for-sale');
const notForSaleCheckbox = document.getElementById('not-for-sale');
const priceFields = document.getElementById('price-fields');
const priceAmount = document.getElementById('price-amount');
const priceCurrency = document.getElementById('price-currency');
function updatePriceFields() {
  const isForSale = Boolean(forSaleCheckbox?.checked);
  if (priceFields) priceFields.hidden = !isForSale;
  if (priceAmount) {
    priceAmount.required = isForSale;
    if (!isForSale) priceAmount.value = '';
  }
}
forSaleCheckbox?.addEventListener('change', () => {
  if (forSaleCheckbox.checked && notForSaleCheckbox) notForSaleCheckbox.checked = false;
  updatePriceFields();
});
notForSaleCheckbox?.addEventListener('change', () => {
  if (notForSaleCheckbox.checked && forSaleCheckbox) forSaleCheckbox.checked = false;
  updatePriceFields();
});
updatePriceFields();

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitButton?.disabled) return;
    const fileInput = document.getElementById('image-upload');
    if (!fileInput.files || !fileInput.files[0]) {
      statusText.textContent = 'Debes seleccionar una imagen.';
      return;
    }
    const selectedStatuses = [
      ...(notForSaleCheckbox.checked ? ['No está a la venta'] : []),
      ...(forSaleCheckbox.checked ? ['A la venta'] : []),
      ...(document.getElementById('salon-participation').checked ? ['Participa en el salón'] : [])
    ];
    if (forSaleCheckbox.checked === notForSaleCheckbox.checked) {
      statusText.textContent = 'Elegí una opción: a la venta o no está a la venta.';
      return;
    }
    const selectedCategories = Array.from(document.getElementById('categoria').selectedOptions).map((option) => option.value);
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('title', document.getElementById('titulo').value.trim());
    formData.append('author', document.getElementById('autor').value.trim());
    formData.append('theme', document.getElementById('tema').value);
    selectedStatuses.forEach((status) => formData.append('commercial_status', status));
    if (forSaleCheckbox.checked) {
      formData.append('price_amount', priceAmount.value);
      formData.append('price_currency', priceCurrency.value);
    }
    formData.append('whatsapp', document.getElementById('whatsapp').value.trim());
    formData.append('email', document.getElementById('email').value.trim());
    formData.append('description', document.getElementById('descripcion').value.trim());
    selectedCategories.forEach((value) => formData.append('category', value));
    statusText.textContent = 'Enviando obra...';
    showSubmissionDialog('Enviando tu obra', 'Estamos recibiendo la información. Esperá un momento.');
    if (submitButton) submitButton.disabled = true;
    try {
      const response = await fetch('/api/works', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'No se pudo enviar la obra.');
      const sheetsFailed = result.googleSheets?.enabled && !result.googleSheets.ok;
      statusText.textContent = sheetsFailed
        ? 'La obra se guardó en el sitio, pero no se pudo confirmar en Google Sheets. Avisá a la organización antes de volver a enviarla.'
        : 'Obra enviada correctamente. Será revisada por la organización.';
      showSubmissionDialog(sheetsFailed ? 'Obra recibida' : '¡Obra enviada!', statusText.textContent);
      form.reset();
      updatePriceFields();
      await loadWorks();
    } catch (error) {
      statusText.textContent = error.message || 'Hubo un error al enviar la obra.';
      showSubmissionDialog('No se pudo enviar', statusText.textContent);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

loadWorks();
