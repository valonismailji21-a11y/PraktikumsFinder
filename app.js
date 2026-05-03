const AppStrings = {
  labels: {
    passend: 'Passend',
    prüfen: 'Prüfen',
    knapp: 'Knapp / klären',
    zu_spaet: 'Zu spät'
  },
  statuses: ['Nicht begonnen', 'Interessant', 'Beworben', 'Gespräch', 'Absage', 'Zusage'],
  emptyList: 'Mit diesen Filtern wurden keine Stellen gefunden.',
  emptySaved: 'Du hast noch keine Stelle gespeichert.'
};

const state = {
  jobs: [],
  meta: {},
  saved: loadSavedState(),
  activeView: 'jobs',
  selectedMapId: null,
  deferredInstallPrompt: null
};

const $ = (id) => document.getElementById(id);
const statusOrder = { passend: 0, prüfen: 1, knapp: 2, zu_spaet: 3 };
const mapBounds = { minLat: 46.94, maxLat: 47.27, minLng: 7.85, maxLng: 8.70 };

function loadSavedState() {
  try {
    return JSON.parse(localStorage.getItem('pf_saved_state_v8') || '{}');
  } catch {
    return {};
  }
}

function persistSavedState() {
  localStorage.setItem('pf_saved_state_v8', JSON.stringify(state.saved));
}

function textSearchBlob(job) {
  return [
    job.title, job.company, job.location, job.canton, job.field, job.workload, job.start,
    job.duration, job.match_reason, job.company_info, job.desirability_label,
    ...(job.tasks || []), ...(job.criteria || [])
  ].join(' ').toLowerCase();
}

function filteredJobs({ savedOnly = false } = {}) {
  const query = $('searchInput').value.trim().toLowerCase();
  const canton = $('cantonFilter').value;
  const status = $('statusFilter').value;
  const sort = $('sortSelect').value;

  const jobs = state.jobs.filter((job) => {
    const isSaved = Boolean(state.saved[job.id]?.saved);
    if (savedOnly && !isSaved) return false;
    const cantonOk = canton === 'all' || job.canton === canton || (canton === 'LU' && job.canton === 'ZG/LU') || (canton === 'ZG' && job.canton === 'ZG/LU');
    const statusOk = status === 'all' || (status === 'active' && job.suitability !== 'zu_spaet') || job.suitability === status;
    const queryOk = query.length === 0 || textSearchBlob(job).includes(query);
    return cantonOk && statusOk && queryOk;
  });

  jobs.sort((a, b) => {
    if (sort === 'score') return (Number(b.desirability_score) || 0) - (Number(a.desirability_score) || 0) || compareFit(a, b);
    if (sort === 'fit') return compareFit(a, b);
    if (sort === 'company') return safeCompare(a.company, b.company);
    if (sort === 'canton') return safeCompare(a.canton, b.canton) || safeCompare(a.company, b.company);
    if (sort === 'saved') return Number(Boolean(state.saved[b.id]?.saved)) - Number(Boolean(state.saved[a.id]?.saved)) || compareFit(a, b);
    return 0;
  });
  return jobs;
}

function compareFit(a, b) {
  return (statusOrder[a.suitability] ?? 9) - (statusOrder[b.suitability] ?? 9) || safeCompare(a.company, b.company);
}

function safeCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'de-CH');
}

function formatDate(value) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function scoreClass(score) {
  if (score >= 76) return 'score-highest';
  if (score >= 62) return 'score-high';
  if (score >= 45) return 'score-medium';
  return 'score-low';
}

function badge(text, className = '') {
  const element = document.createElement('span');
  element.className = `badge ${className}`.trim();
  element.textContent = text;
  return element;
}

function metaPill(label, value) {
  const element = document.createElement('span');
  element.className = 'meta-pill';
  element.textContent = `${label}: ${value || '–'}`;
  return element;
}

function setScoreRing(ring, score) {
  const numeric = Number(score) || 0;
  ring.style.setProperty('--score-deg', `${numeric * 3.6}deg`);
  if (numeric >= 76) ring.style.background = `conic-gradient(var(--green) ${numeric * 3.6}deg, rgba(127,127,127,.18) 0deg)`;
  else if (numeric >= 62) ring.style.background = `conic-gradient(var(--blue) ${numeric * 3.6}deg, rgba(127,127,127,.18) 0deg)`;
  else if (numeric >= 45) ring.style.background = `conic-gradient(var(--orange) ${numeric * 3.6}deg, rgba(127,127,127,.18) 0deg)`;
  else ring.style.background = `conic-gradient(var(--red) ${numeric * 3.6}deg, rgba(127,127,127,.18) 0deg)`;
  ring.querySelector('strong').textContent = numeric || '–';
}

function renderJobCard(job, { compact = false } = {}) {
  const template = $('jobCardTemplate');
  const node = template.content.cloneNode(true);
  const card = node.querySelector('.job-card');
  if (compact) card.classList.add('compact-card');

  const badges = node.querySelector('.badge-row');
  badges.appendChild(badge(AppStrings.labels[job.suitability] || 'Prüfen', job.suitability || 'prüfen'));
  badges.appendChild(badge(job.canton || 'Kanton prüfen'));
  badges.appendChild(badge(`${job.desirability_score || '–'}/100`, 'score'));

  const saveButton = node.querySelector('.save-button');
  updateSaveButton(saveButton, job.id);
  saveButton.addEventListener('click', () => {
    toggleSaved(job.id);
    renderAll();
  });

  node.querySelector('.job-title').textContent = job.title || 'Unbenannte Stelle';
  node.querySelector('.company-line').textContent = `${job.company || 'Firma prüfen'} · ${job.location || 'Ort prüfen'}`;

  const ring = node.querySelector('.score-ring');
  setScoreRing(ring, job.desirability_score);
  node.querySelector('.score-title').textContent = `Begehrtheit: ${job.desirability_label || 'nicht bewertet'}`;
  node.querySelector('.score-subtitle').textContent = job.desirability_explanation || 'Schätzwert aus den verfügbaren Stellenangaben.';

  const meta = node.querySelector('.meta-pills');
  meta.appendChild(metaPill('Bereich', job.field));
  meta.appendChild(metaPill('Pensum', job.workload));
  meta.appendChild(metaPill('Start', job.start));
  meta.appendChild(metaPill('Dauer', job.duration));
  node.querySelector('.match-reason').textContent = job.match_reason || 'Passung im Originalinserat prüfen.';

  const detailButton = node.querySelector('.detail-button');
  detailButton.addEventListener('click', () => openJobDialog(job.id));

  const sourceLink = node.querySelector('.source-link');
  sourceLink.href = safeUrl(job.source_url);
  sourceLink.textContent = 'Inserat öffnen';
  sourceLink.setAttribute('aria-label', `Originalinserat für ${job.title || 'Stelle'} öffnen`);

  return node;
}

function updateSaveButton(button, jobId) {
  const isSaved = Boolean(state.saved[jobId]?.saved);
  button.textContent = isSaved ? 'Gemerkt' : 'Merken';
  button.classList.toggle('saved', isSaved);
  button.setAttribute('aria-pressed', String(isSaved));
}

function toggleSaved(jobId) {
  const current = state.saved[jobId] || { saved: false, status: 'Nicht begonnen', note: '' };
  state.saved[jobId] = { ...current, saved: !current.saved };
  persistSavedState();
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : '#';
  } catch {
    return '#';
  }
}

function renderStats() {
  const activeCount = state.jobs.filter((job) => job.suitability !== 'zu_spaet').length;
  const topScore = state.jobs.reduce((max, job) => Math.max(max, Number(job.desirability_score) || 0), 0);
  $('statJobs').textContent = String(state.jobs.length);
  $('statActive').textContent = String(activeCount);
  $('statTop').textContent = topScore ? `${topScore}/100` : '–';
  $('statUpdated').textContent = formatDate(state.meta.updated_at);
}

function renderJobList() {
  const jobs = filteredJobs();
  const list = $('jobsList');
  list.innerHTML = '';
  $('resultCount').textContent = `${jobs.length} Treffer`;

  if (!jobs.length) {
    list.appendChild(emptyState(AppStrings.emptyList));
    return;
  }
  jobs.forEach((job) => list.appendChild(renderJobCard(job)));
}

function renderSavedList() {
  const jobs = filteredJobs({ savedOnly: true });
  const list = $('savedList');
  list.innerHTML = '';
  $('savedCount').textContent = `${jobs.length} gespeichert`;

  if (!jobs.length) {
    list.appendChild(emptyState(AppStrings.emptySaved));
    return;
  }
  jobs.forEach((job) => list.appendChild(renderJobCard(job)));
}

function emptyState(text) {
  const element = document.createElement('div');
  element.className = 'notice glass';
  element.textContent = text;
  return element;
}

function projectPoint(job, index, groupSize) {
  const lng = Number(job.map_lng);
  const lat = Number(job.map_lat);
  const baseX = ((lng - mapBounds.minLng) / (mapBounds.maxLng - mapBounds.minLng)) * 88 + 6;
  const baseY = ((mapBounds.maxLat - lat) / (mapBounds.maxLat - mapBounds.minLat)) * 82 + 9;
  if (groupSize <= 1) return { x: clamp(baseX, 7, 93), y: clamp(baseY, 8, 92) };
  const angle = (Math.PI * 2 * index) / groupSize;
  const radius = Math.min(7, 2.5 + groupSize * 0.9);
  return { x: clamp(baseX + Math.cos(angle) * radius, 7, 93), y: clamp(baseY + Math.sin(angle) * radius, 8, 92) };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mapJobs() {
  return filteredJobs().filter((job) => Number.isFinite(Number(job.map_lat)) && Number.isFinite(Number(job.map_lng)));
}

function groupedByLocation(jobs) {
  const groups = new Map();
  jobs.forEach((job) => {
    const key = `${Number(job.map_lat).toFixed(4)}|${Number(job.map_lng).toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  });
  return groups;
}

function renderMap() {
  const jobs = mapJobs();
  const markerRoot = $('mapMarkers');
  const details = $('mapDetails');
  const chips = $('locationChips');
  markerRoot.innerHTML = '';
  chips.innerHTML = '';
  $('mapCount').textContent = `${jobs.length} Marker`;

  if (!jobs.length) {
    details.innerHTML = '<div class="map-details-empty">Keine kartierbaren Stellen für die aktuellen Filter.</div>';
    return;
  }

  const groups = groupedByLocation(jobs);
  let firstJob = null;
  for (const [key, group] of groups.entries()) {
    group.forEach((job, index) => {
      const point = projectPoint(job, index, group.length);
      const score = Number(job.desirability_score) || 0;
      const groupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      groupElement.setAttribute('class', 'marker-hit');
      groupElement.setAttribute('role', 'button');
      groupElement.setAttribute('tabindex', '0');
      groupElement.setAttribute('aria-label', `${job.company}, ${job.title}, Begehrtheit ${score} von 100`);
      groupElement.dataset.jobId = job.id;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'marker-pin');
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', state.selectedMapId === job.id ? '4.7' : '3.7');
      circle.setAttribute('fill', markerColor(score));
      circle.setAttribute('stroke', 'white');
      circle.setAttribute('stroke-width', '1.1');

      const countText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      countText.setAttribute('class', 'marker-count');
      countText.setAttribute('x', String(point.x));
      countText.setAttribute('y', String(point.y + 0.2));
      countText.textContent = String(score);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'marker-label');
      label.setAttribute('x', String(point.x + 4.8));
      label.setAttribute('y', String(point.y - 3.8));
      label.textContent = shortLocation(job.map_label || job.location || job.canton || 'Ort');

      const select = () => {
        state.selectedMapId = job.id;
        renderMap();
      };
      groupElement.addEventListener('click', select);
      groupElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
      groupElement.append(circle, countText, label);
      markerRoot.appendChild(groupElement);
      if (!firstJob) firstJob = job;
    });

    const chip = document.createElement('button');
    chip.className = 'location-chip';
    chip.type = 'button';
    chip.textContent = `${group[0].map_label || group[0].location} · ${group.length}`;
    chip.addEventListener('click', () => {
      state.selectedMapId = group[0].id;
      renderMap();
    });
    chips.appendChild(chip);
  }

  const selectedJob = jobs.find((job) => job.id === state.selectedMapId) || firstJob;
  if (selectedJob) {
    state.selectedMapId = selectedJob.id;
    details.innerHTML = '';
    details.appendChild(renderMapDetails(selectedJob));
  }
}

function markerColor(score) {
  if (score >= 76) return '#34c759';
  if (score >= 62) return '#007aff';
  if (score >= 45) return '#ff9500';
  return '#ff3b30';
}

function shortLocation(value) {
  const text = String(value || '').replace(', LU', '').replace(', ZG', '').trim();
  return text.length > 12 ? `${text.slice(0, 11)}…` : text;
}

function renderMapDetails(job) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = '';
  const title = document.createElement('h3');
  title.className = 'map-detail-title';
  title.textContent = job.title || 'Unbenannte Stelle';
  const company = document.createElement('p');
  company.className = 'company-line';
  company.textContent = `${job.company || 'Firma prüfen'} · ${job.location || 'Ort prüfen'}`;

  const badges = document.createElement('div');
  badges.className = 'badge-row';
  badges.appendChild(badge(AppStrings.labels[job.suitability] || 'Prüfen', job.suitability || 'prüfen'));
  badges.appendChild(badge(`${job.desirability_score || '–'}/100`, 'score'));

  const meta = document.createElement('div');
  meta.className = 'meta-pills';
  meta.appendChild(metaPill('Bereich', job.field));
  meta.appendChild(metaPill('Start', job.start));
  meta.appendChild(metaPill('Pensum', job.workload));

  const reason = document.createElement('p');
  reason.className = 'match-reason';
  reason.textContent = job.match_reason || 'Passung prüfen.';

  const detailsButton = document.createElement('button');
  detailsButton.className = 'secondary-button full-width';
  detailsButton.type = 'button';
  detailsButton.textContent = 'Alle Details anzeigen';
  detailsButton.addEventListener('click', () => openJobDialog(job.id));

  wrapper.append(badges, title, company, meta, reason, detailsButton);
  return wrapper;
}

function openJobDialog(jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const dialog = $('detailDialog');
  const content = $('dialogContent');
  const saved = state.saved[job.id] || { saved: false, status: 'Nicht begonnen', note: '' };
  content.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'detail-header';
  const titleGroup = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = job.title || 'Unbenannte Stelle';
  const company = document.createElement('p');
  company.className = 'company-line';
  company.textContent = `${job.company || 'Firma prüfen'} · ${job.location || 'Ort prüfen'}`;
  titleGroup.append(title, company);
  const saveButton = document.createElement('button');
  saveButton.className = 'save-button';
  saveButton.type = 'button';
  updateSaveButton(saveButton, job.id);
  saveButton.addEventListener('click', () => {
    toggleSaved(job.id);
    updateSaveButton(saveButton, job.id);
    renderAll();
  });
  header.append(titleGroup, saveButton);

  const meta = document.createElement('div');
  meta.className = 'meta-pills';
  meta.appendChild(metaPill('Begehrtheit', `${job.desirability_score || '–'}/100`));
  meta.appendChild(metaPill('Status', AppStrings.labels[job.suitability] || 'Prüfen'));
  meta.appendChild(metaPill('Start', job.start));
  meta.appendChild(metaPill('Dauer', job.duration));
  meta.appendChild(metaPill('Pensum', job.workload));

  const explanation = document.createElement('p');
  explanation.className = 'match-reason';
  explanation.textContent = job.desirability_explanation || 'Schätzwert aus verfügbaren Daten.';

  const factors = listSection('Bewertungsfaktoren', job.desirability_factors || []);
  const tasks = listSection('Aufgaben', job.tasks || []);
  const criteria = listSection('Einstellungskriterien', job.criteria || []);

  const statusSection = document.createElement('div');
  statusSection.className = 'status-grid detail-section';
  const statusLabel = document.createElement('label');
  statusLabel.className = 'control';
  const statusText = document.createElement('span');
  statusText.textContent = 'Mein Bewerbungsstatus';
  const statusSelect = document.createElement('select');
  AppStrings.statuses.forEach((status) => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    option.selected = saved.status === status;
    statusSelect.appendChild(option);
  });
  statusSelect.addEventListener('change', () => {
    state.saved[job.id] = { ...state.saved[job.id], saved: true, status: statusSelect.value };
    persistSavedState();
    renderAll();
  });
  statusLabel.append(statusText, statusSelect);

  const noteLabel = document.createElement('label');
  noteLabel.className = 'control note-area';
  const noteText = document.createElement('span');
  noteText.textContent = 'Meine Notiz';
  const textarea = document.createElement('textarea');
  textarea.value = saved.note || '';
  textarea.placeholder = 'z. B. Bewerbungsfrist, Kontaktperson oder nächster Schritt';
  textarea.addEventListener('input', () => {
    state.saved[job.id] = { ...state.saved[job.id], saved: true, note: textarea.value };
    persistSavedState();
    renderAll();
  });
  noteLabel.append(noteText, textarea);
  statusSection.append(statusLabel, noteLabel);

  const source = document.createElement('a');
  source.className = 'primary-button full-width';
  source.href = safeUrl(job.source_url);
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.textContent = 'Originalinserat öffnen';

  content.append(header, meta, explanation, factors, tasks, criteria, statusSection, source);
  dialog.showModal();
}

function listSection(title, items) {
  const section = document.createElement('section');
  section.className = 'detail-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('ul');
  list.className = 'clean-list';
  const safeItems = items.length ? items : ['Keine Detailangaben erkannt. Originalinserat prüfen.'];
  safeItems.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  section.append(heading, list);
  return section;
}

function switchView(view) {
  state.activeView = view;
  document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active-view', element.id === `view-${view}`));
  document.querySelectorAll('.tab-button').forEach((button) => button.classList.toggle('active-tab', button.dataset.view === view));
  if (view === 'map') renderMap();
  if (view === 'saved') renderSavedList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadData({ manual = false } = {}) {
  const button = $('refreshButton');
  button.disabled = true;
  button.textContent = manual ? 'Lade neu …' : 'Lade …';
  try {
    const response = await fetch(`data/jobs.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const jobs = await response.json();
    const metaResponse = await fetch(`data/metadata.json?ts=${Date.now()}`, { cache: 'no-store' });
    let meta = {};
    if (metaResponse.ok) meta = await metaResponse.json();
    state.jobs = Array.isArray(jobs) ? jobs : [];
    state.meta = meta;
  } catch (error) {
    const fallback = window.PF_BOOTSTRAP_DATA || { jobs: [], meta: {} };
    state.jobs = fallback.jobs || [];
    state.meta = fallback.meta || {};
    showNotice(`Live-Daten konnten nicht geladen werden. Es werden die eingebetteten Daten angezeigt. Grund: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Daten neu laden';
    renderAll();
  }
}

function showNotice(message) {
  const notice = $('notice');
  notice.hidden = false;
  notice.textContent = message;
}

function hideNotice() {
  const notice = $('notice');
  notice.hidden = true;
  notice.textContent = '';
}

function renderAll() {
  hideNotice();
  renderStats();
  renderJobList();
  renderSavedList();
  if (state.activeView === 'map') renderMap();
}

function resetFilters() {
  $('searchInput').value = '';
  $('cantonFilter').value = 'all';
  $('statusFilter').value = 'active';
  $('sortSelect').value = 'score';
  renderAll();
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    $('installButton').hidden = false;
  });
  $('installButton').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    $('installButton').hidden = true;
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('service-worker.js').catch(() => undefined);
  }
}

function bindEvents() {
  ['searchInput', 'cantonFilter', 'statusFilter', 'sortSelect'].forEach((id) => {
    $(id).addEventListener('input', renderAll);
    $(id).addEventListener('change', renderAll);
  });
  $('refreshButton').addEventListener('click', () => loadData({ manual: true }));
  $('resetFiltersButton').addEventListener('click', resetFilters);
  $('closeDialogButton').addEventListener('click', () => $('detailDialog').close());
  $('openInstructionsButton').addEventListener('click', () => $('instructionsDialog').showModal());
  $('closeInstructionsButton').addEventListener('click', () => $('instructionsDialog').close());
  document.querySelectorAll('.tab-button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
}

function scheduleRefresh() {
  setInterval(() => loadData({ manual: false }), 30 * 60 * 1000);
}

bindEvents();
setupInstallPrompt();
registerServiceWorker();
loadData();
scheduleRefresh();
