/* IHK Audit PWA v3.1.2 */
const APP_BUILD = '3.1.2';
// Papar ralat kepada pengguna — jangan crash senyap
window.addEventListener('error', e => { try { toast('Ralat: ' + (e.message || 'tidak diketahui')); } catch { } });
window.addEventListener('unhandledrejection', e => { try { toast('Ralat: ' + (e.reason?.message || e.reason)); } catch { } });

// Pastikan index.html sepadan dengan app.js (punca biasa: fail lama dalam cache / tak tertindih)
function checkBuild() {
  const need = ['legalList', 'photoList', 'exitAuditBtn', 'summaryBack', 'notifBtn', 'notifDot', 'findingDrawer', 'nonComplianceBlock'];
  const missing = need.filter(id => !document.getElementById(id));
  const htmlBuild = document.documentElement.dataset.build;
  if (!missing.length && htmlBuild === APP_BUILD) return true;
  console.error('Versi tidak sepadan', { htmlBuild, APP_BUILD, missing });
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;inset:auto 12px 12px;z-index:99;background:#b61d2b;color:#fff;padding:14px;border-radius:14px;font-weight:700;box-shadow:0 10px 30px #0004';
  bar.innerHTML = 'Fail app tidak sepadan (versi lama dalam cache). <button style="margin-left:8px;border:0;border-radius:8px;padding:8px 12px;font-weight:800" id="hardReload">Muat semula app</button>';
  document.body.appendChild(bar);
  document.getElementById('hardReload').onclick = hardReload;
  return !missing.length; // jika hanya nombor versi beza, app masih boleh jalan
}

// Buang service worker + cache app sahaja. Data audit (localStorage/IndexedDB) TIDAK terjejas.
async function hardReload() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
    await Promise.all(regs.map(r => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('ihk-audit-')).map(k => caches.delete(k)));
  } catch (e) { console.warn(e); }
  location.replace(location.pathname + '?r=' + Date.now());
}
const $ = id => document.getElementById(id);
const qa = s => [...document.querySelectorAll(s)];
const state = { program: 'MeSTI', auditType: 'Rutin', checklist: [], risk: [], legal: [], responses: {}, current: null, meta: {}, directiveType: 'Arahan Pembetulan', viewOnly: false };
const VIEWS = ['home', 'program', 'audit', 'list', 'summary'];
const LS_DRAFT = 'IHK_AUDIT_DRAFT_V3', LS_HISTORY = 'IHK_AUDIT_HISTORY_V3', LS_PENDING = 'IHK_PENDING_SYNC_V2';

/* ---------- Utiliti ---------- */
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function show(name) { VIEWS.forEach(v => $('view-' + v)?.classList.toggle('active', v === name)); scrollTo({ top: 0, behavior: 'smooth' }); }
// Tarikh tempatan (BUKAN toISOString yang guna UTC — salah 8 jam di Malaysia)
function ymd(d) { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
function today() { return ymd(new Date()); }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + Number(n)); return ymd(d); }
const readLS = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def; } catch { return def; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Storan peranti penuh — sila sync / padam rekod lama'); return false; } };

/* ---------- IndexedDB untuk gambar (localStorage terlalu kecil) ---------- */
const PhotoDB = (() => {
  let dbp;
  const open = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('ihk-audit', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('photos', mode); const out = fn(t.objectStore('photos')); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };
  return {
    put: p => tx('readwrite', s => s.put(p)),
    get: id => tx('readonly', s => s.get(id)),
    del: id => tx('readwrite', s => s.delete(id)),
    all: () => tx('readonly', s => s.getAll())
  };
})();

function compressImage(file, maxSide, quality) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Gambar tidak dapat dibaca')); };
    img.src = url;
  });
}

/* ---------- Init ---------- */
async function init() {
  if (!checkBuild()) return;
  try {
    [state.risk, state.legal] = await Promise.all([fetch('risk-master.json').then(r => r.json()), fetch('legal-master.json').then(r => r.json())]);
  } catch (e) { console.warn(e); toast('Gagal memuat master risiko/perundangan'); }
  migrateOldPending();
  bind(); renderProgramPicker(); updateNetwork(); loadDashboard(); registerSW(); installPrompt();
  if (navigator.onLine) syncAll();
}

function bind() {
  qa('[data-nav]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.nav)));
  qa('[data-program]').forEach(b => b.addEventListener('click', () => { state.program = b.dataset.program; startProgramFlow(); }));
  qa('[data-action="new"]').forEach(b => b.addEventListener('click', () => startProgramFlow()));
  $('continueAuditBtn').onclick = beginAudit;
  $('saveDraftBtn').onclick = () => saveDraft(true);
  $('summaryBtn').onclick = () => { state.viewOnly = false; showSummary(); };
  $('exitAuditBtn').onclick = () => { saveDraft(false); show('home'); loadDashboard(); };
  $('closeFinding').onclick = closeFinding;
  $('saveFindingBtn').onclick = saveFinding;
  $('notifBtn').onclick = () => renderList('directives');
  qa('[data-status]').forEach(b => b.onclick = () => setStatus(b.dataset.status));
  qa('[data-directive]').forEach(b => b.onclick = () => selectDirective(b.dataset.directive));
  $('duePreset').onchange = () => { const v = $('duePreset').value; if (v !== '' && v !== 'custom') $('dueDate').value = addDays(v); if (v === 'custom') $('dueDate').focus(); };
  $('photoInput').onchange = onPhotos;
  $('findingDrawer').addEventListener('click', e => { if (e.target.id === 'findingDrawer') closeFinding(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('findingDrawer').classList.contains('hidden')) closeFinding(); });
  window.addEventListener('online', () => { updateNetwork(); syncAll(); });
  window.addEventListener('offline', updateNetwork);
}

function navigate(name) {
  if (name === 'home') { show('home'); return loadDashboard(); }
  if (name === 'program') return startProgramFlow();
  if (name === 'audit') return show('audit');
  if (['audits', 'directives', 'followups', 'reports'].includes(name)) return renderList(name);
}

function startProgramFlow() { renderProgramPicker(); show('program'); }

function renderProgramPicker() {
  const programs = [['MeSTI', 'Makanan Selamat Tanggungjawab Industri', 'mesti'], ['GMP', 'Amalan Pengilangan Baik', 'gmp'], ['BeSS', 'Bersih, Selamat dan Sihat', 'bess'], ['HACCP', 'Analisis Bahaya & Kawalan Titik Kritikal', 'haccp']];
  $('programPicker').innerHTML = programs.map(([p, d, c]) => `<button class="program-card ${p === state.program ? 'selected' : ''}" data-pick-program="${p}"><span class="program-logo"><img src="assets/img/logo-${c}.webp" alt="Logo ${p}" loading="lazy"></span><span><b>${p}</b><small>${d}${p === 'MeSTI' ? '' : ' · akan datang'}</small></span><i>›</i></button>`).join('');
  qa('[data-pick-program]').forEach(b => b.onclick = () => { state.program = b.dataset.pickProgram; renderProgramPicker(); });
  qa('[data-type]').forEach(b => {
    b.classList.toggle('selected', b.dataset.type === state.auditType);
    b.onclick = () => { state.auditType = b.dataset.type; qa('[data-type]').forEach(x => x.classList.toggle('selected', x === b)); };
  });
}

/* ---------- Audit ---------- */
async function loadChecklist(program) {
  if (program !== 'MeSTI') throw new Error(`${program}: checklist master belum dimasukkan`);
  const rows = await fetch('mesti-checklist.json').then(r => r.json());
  return rows.filter(q => q.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
}

async function beginAudit() {
  try { state.checklist = await loadChecklist(state.program); } catch (e) { toast(e.message); return; }
  const d = readLS(LS_DRAFT, null);
  if (d?.meta && d.meta.program === state.program && confirm(`Terdapat draf ${state.program} (${d.meta.premis || 'premis belum diisi'}). Sambung draf tersebut?`)) {
    state.meta = d.meta; state.responses = d.responses || {};
  } else {
    if (d?.meta && Object.keys(d.responses || {}).length && !confirm('Draf sedia ada akan digantikan dengan audit baharu. Teruskan?')) return;
    state.meta = { program: state.program, jenis: state.auditType, audit_id: uid(), tarikh: today(), created_at: new Date().toISOString() };
    state.responses = {};
  }
  openAuditView();
}

async function resumeDraft() {
  const d = readLS(LS_DRAFT, null); if (!d?.meta) return;
  state.program = d.meta.program;
  try { state.checklist = await loadChecklist(state.program); } catch (e) { toast(e.message); return; }
  state.meta = d.meta; state.responses = d.responses || {}; openAuditView();
}

function openAuditView() {
  state.viewOnly = false;
  $('auditProgramLabel').textContent = state.program; $('auditTitle').textContent = `Pemeriksaan ${state.program}`;
  $('jenis').value = state.meta.jenis || state.auditType; $('tarikh').value = state.meta.tarikh || today();
  $('premis').value = state.meta.premis || ''; $('auditor').value = state.meta.auditor || '';
  renderSections(); show('audit');
}

function renderSections() {
  const groups = {}; state.checklist.forEach(q => (groups[q.section] ??= []).push(q));
  const openNow = new Set(qa('.section-body:not(.hidden)').map(el => el.id));
  $('sectionList').innerHTML = Object.entries(groups).map(([s, qs]) => {
    const done = qs.filter(q => state.responses[q.id]?.status).length;
    const tp = qs.filter(q => state.responses[q.id]?.status === 'Tidak Patuh').length;
    const isOpen = openNow.has('sec-' + s);
    return `<article class="section-card"><button class="section-btn" data-sec="${esc(s)}" aria-expanded="${isOpen}"><span><b>${esc(s)}. ${esc(qs[0].section_name)}</b><br><span>${done}/${qs.length} item selesai${tp ? ` · <span style="color:var(--danger)">${tp} tidak patuh</span>` : ''}</span></span><span>⌄</span></button><div class="section-body ${isOpen ? '' : 'hidden'}" id="sec-${esc(s)}">${qs.map(questionHtml).join('')}</div></article>`;
  }).join('');
  qa('[data-sec]').forEach(b => b.onclick = () => { const el = $('sec-' + b.dataset.sec); el.classList.toggle('hidden'); b.setAttribute('aria-expanded', !el.classList.contains('hidden')); });
  qa('[data-q]').forEach(b => b.onclick = () => openFinding(b.dataset.q));
  updateProgress();
}

function questionHtml(q) {
  const r = state.responses[q.id] || {};
  const cls = r.status === 'Patuh' ? 'pass' : r.status === 'Tidak Patuh' ? 'fail' : r.status === 'N/A' ? 'na' : '';
  const meta = [r.demerit ? `Demerit ${r.demerit}` : '', r.status === 'Tidak Patuh' ? r.directiveType : '', r.photos?.length ? `📷 ${r.photos.length}` : ''].filter(Boolean).join(' · ');
  return `<button class="question-item" data-q="${esc(q.id)}"><div><span class="qcode">${esc(q.code)}</span>${esc(q.question)}<div class="qmeta">${esc(meta)}</div></div><span class="status-pill ${cls}">${esc(r.status || 'Belum dinilai')}</span></button>`;
}

function updateProgress() {
  const done = state.checklist.filter(q => state.responses[q.id]?.status).length;
  const p = state.checklist.length ? Math.round(done / state.checklist.length * 100) : 0;
  $('progressText').textContent = `${done}/${state.checklist.length} item · ${p}%`; $('progressBar').style.width = p + '%';
}

/* ---------- Drawer penemuan ---------- */
function openFinding(id) {
  state.current = state.checklist.find(q => q.id === id); if (!state.current) return;
  // Salinan kerja — perubahan hanya disimpan bila tekan "Simpan Penemuan"
  state.work = JSON.parse(JSON.stringify(state.responses[id] || {}));
  const r = state.work;
  $('findingCode').textContent = `${state.current.code} · ${state.current.section_name}`;
  $('findingDomain').textContent = `Seksyen ${state.current.section} · ${state.current.subelement || ''}`;
  $('findingQ').textContent = state.current.question;
  $('findingNote').value = r.note || ''; $('findingEvidence').value = r.evidence || '';
  $('riskSelect').innerHTML = '<option value="">-- pilih jika berkaitan --</option>' + state.risk.map(x => `<option value="${esc(x.risk_id)}" ${r.risk_id === x.risk_id ? 'selected' : ''}>${esc(x.risk_id)} · ${esc(x.domain)} · ${esc(x.description)} (${x.demerit} demerit)</option>`).join('');
  $('legalList').innerHTML = state.legal.map(x => `<label><input type="checkbox" value="${esc(x.reg)}" ${(r.legal || []).includes(x.reg) ? 'checked' : ''}><span>Per. ${esc(x.reg)} — ${esc(x.title)}</span></label>`).join('');
  $('directiveText').value = r.directiveText || ''; $('duePreset').value = ''; $('dueDate').value = r.dueDate || ''; $('followDate').value = r.followDate || ''; $('section10').checked = !!r.section10;
  state.directiveType = r.directiveType || 'Arahan Pembetulan';
  qa('[data-status]').forEach(b => b.classList.toggle('active', b.dataset.status === r.status));
  qa('[data-directive]').forEach(b => b.classList.toggle('selected', b.dataset.directive === state.directiveType));
  $('nonComplianceBlock').classList.toggle('hidden', r.status !== 'Tidak Patuh');
  renderPhotos();
  $('findingDrawer').classList.remove('hidden');
}

function closeFinding() { $('findingDrawer').classList.add('hidden'); state.current = null; state.work = null; }

function setStatus(st) {
  if (!state.current) return; state.work.status = st;
  qa('[data-status]').forEach(b => b.classList.toggle('active', b.dataset.status === st));
  $('nonComplianceBlock').classList.toggle('hidden', st !== 'Tidak Patuh');
  if (st === 'Tidak Patuh' && !$('followDate').value) $('followDate').value = $('dueDate').value || '';
}

function selectDirective(v) { state.directiveType = v; qa('[data-directive]').forEach(b => b.classList.toggle('selected', b.dataset.directive === v)); }

function saveFinding() {
  if (!state.current) return;
  const r = state.work;
  if (!r.status) { toast('Pilih status item dahulu'); return; }
  r.note = $('findingNote').value.trim(); r.evidence = $('findingEvidence').value.trim();
  if (r.status === 'Tidak Patuh') {
    if (!r.note) { toast('Nyatakan penemuan bagi item tidak patuh'); $('findingNote').focus(); return; }
    r.risk_id = $('riskSelect').value;
    r.demerit = Number(state.risk.find(x => x.risk_id === r.risk_id)?.demerit || 0);
    r.legal = qa('#legalList input:checked').map(i => i.value);
    r.directiveType = state.directiveType; r.directiveText = $('directiveText').value.trim();
    r.dueDate = $('dueDate').value; r.followDate = $('followDate').value; r.section10 = $('section10').checked;
    if (r.followDate && r.dueDate && r.followDate < r.dueDate) toast('Perhatian: tarikh susulan sebelum tarikh akhir arahan');
  } else {
    // Bersihkan SEMUA medan ketidakpatuhan (versi lama tinggal dueDate/followDate → susulan palsu)
    ['risk_id', 'demerit', 'legal', 'directiveType', 'directiveText', 'dueDate', 'followDate', 'section10'].forEach(k => delete r[k]);
  }
  state.responses[state.current.id] = r;
  saveDraft(false); closeFinding(); renderSections(); toast('Penemuan disimpan');
}

/* ---------- Gambar ---------- */
async function onPhotos(e) {
  const files = [...e.target.files]; e.target.value = '';
  if (!state.current || !files.length) return;
  const r = state.work; r.photos ??= [];
  for (const f of files) {
    try {
      const [full, thumb] = await Promise.all([compressImage(f, 1600, 0.72), compressImage(f, 240, 0.6)]);
      const id = uid();
      await PhotoDB.put({ id, audit_id: state.meta.audit_id, item_id: state.current.id, name: `${state.current.code}_${Date.now()}.jpg`, full, thumb, uploaded: false, url: '' });
      r.photos.push(id);
    } catch (err) { toast(err.message); }
  }
  // Simpan rujukan gambar terus supaya tidak hilang walaupun drawer ditutup tanpa simpan
  const saved = state.responses[state.current.id] || {}; saved.photos = [...r.photos]; state.responses[state.current.id] = saved;
  saveDraft(false); renderPhotos(); toast(`${files.length} gambar disimpan pada peranti`);
  if (navigator.onLine) syncPhotos();
}

async function renderPhotos() {
  const ids = state.work?.photos || [];
  const items = (await Promise.all(ids.map(id => PhotoDB.get(id).catch(() => null)))).filter(Boolean);
  $('photoList').innerHTML = items.map(p => `<div class="thumb"><img src="${p.thumb}" alt="Gambar bukti"><span class="badge ${p.uploaded ? 'ok' : ''}">${p.uploaded ? '✓ Drive' : 'Belum sync'}</span>${state.viewOnly ? '' : `<button class="del" data-del-photo="${p.id}" aria-label="Buang gambar">✕</button>`}</div>`).join('');
  qa('[data-del-photo]').forEach(b => b.onclick = async () => {
    if (!confirm('Buang gambar ini dari audit?')) return;
    const id = b.dataset.delPhoto; await PhotoDB.del(id);
    state.work.photos = state.work.photos.filter(x => x !== id);
    const saved = state.responses[state.current.id]; if (saved) saved.photos = [...state.work.photos];
    saveDraft(false); renderPhotos();
  });
}

let photoSyncing = false;
async function syncPhotos() {
  if (photoSyncing || !IHKApi.configured()) return; photoSyncing = true;
  try {
    const pending = (await PhotoDB.all()).filter(p => !p.uploaded);
    for (const p of pending) {
      try {
        const res = await IHKApi.uploadEvidence({ evidence_id: p.id, audit_id: p.audit_id, finding_id: `${p.audit_id}_${p.item_id}`, name: p.name, mime: 'image/jpeg', base64: p.full });
        await PhotoDB.put({ ...p, uploaded: true, url: res.FILE_URL || '', full: '' }); // buang fail penuh selepas upload
      } catch (e) { console.warn('Upload gambar gagal', e); break; }
    }
  } finally { photoSyncing = false; }
  if (!$('findingDrawer').classList.contains('hidden')) renderPhotos();
}

/* ---------- Simpan & sync ---------- */
function captureMeta() {
  if (state.viewOnly) return;
  state.meta = { ...state.meta, premis: $('premis').value.trim(), tarikh: $('tarikh').value, auditor: $('auditor').value.trim(), jenis: $('jenis').value, program: state.program, audit_id: state.meta.audit_id || uid(), updated_at: new Date().toISOString() };
}

function saveDraft(showToast = true) {
  if (state.viewOnly || !state.meta.audit_id) return;
  captureMeta();
  const rec = { meta: { ...state.meta, status: 'DRAFT' }, responses: state.responses };
  if (writeLS(LS_DRAFT, rec) && showToast) toast('Draf disimpan pada peranti');
  markPending(rec); scheduleSync();
}

// Barisan sync ikut audit_id (versi lama hanya simpan 1 rekod — rekod lain hilang)
function markPending(rec) { const q = readLS(LS_PENDING, {}); q[rec.meta.audit_id] = rec; writeLS(LS_PENDING, q); updateSyncChip(); }
function migrateOldPending() { const old = readLS('IHK_PENDING_SYNC', null); if (old?.meta?.audit_id) markPending(old); localStorage.removeItem('IHK_PENDING_SYNC'); }
function scheduleSync() { clearTimeout(scheduleSync.t); scheduleSync.t = setTimeout(syncAll, 3000); }

let syncing = false;
async function syncAll(showResult = false) {
  if (syncing || !navigator.onLine || !IHKApi.configured()) { updateSyncChip(); return; }
  syncing = true; let ok = 0;
  try {
    const q = readLS(LS_PENDING, {});
    for (const [id, rec] of Object.entries(q)) {
      try {
        await IHKApi.saveAudit(rec);
        const now = readLS(LS_PENDING, {});
        if (now[id] && now[id].meta.updated_at === rec.meta.updated_at) { delete now[id]; writeLS(LS_PENDING, now); } // jangan buang jika ada versi lebih baharu
        ok++;
      } catch (e) { console.warn('Sync gagal', e); if (showResult) toast('Sync gagal: ' + e.message); break; }
    }
  } finally { syncing = false; updateSyncChip(); }
  if (ok && showResult) toast('Data berjaya disegerakkan');
  syncPhotos();
}

function updateSyncChip() {
  const n = Object.keys(readLS(LS_PENDING, {})).length;
  $('netText').innerHTML = (navigator.onLine ? 'online' : 'offline') + (n && IHKApi.configured() ? ` <span class="sync-chip">${n} belum sync</span>` : '');
}

/* ---------- Rumusan ---------- */
function computeStats(checklist, responses) {
  const st = q => responses[q.id]?.status;
  const np = checklist.filter(q => st(q) === 'Tidak Patuh');
  const patuh = checklist.filter(q => st(q) === 'Patuh').length;
  const na = checklist.filter(q => st(q) === 'N/A').length;
  const unanswered = checklist.filter(q => !st(q)).length;
  const assessed = patuh + np.length;
  const score = assessed ? Math.round(patuh / assessed * 100) : 0;
  const demerit = np.reduce((a, q) => a + (Number(responses[q.id]?.demerit) || 0), 0);
  return { np, patuh, na, unanswered, assessed, score, demerit };
}

function showSummary() {
  captureMeta();
  const s = computeStats(state.checklist, state.responses);
  const legal = [...new Set(s.np.flatMap(q => state.responses[q.id]?.legal || []))].sort((a, b) => a - b);
  const legalTitle = reg => state.legal.find(l => l.reg === reg)?.title || '';
  const level = s.demerit >= 20 ? 'Tinggi' : s.demerit >= 10 ? 'Sederhana' : 'Rendah';
  const fups = s.np.filter(q => state.responses[q.id]?.followDate).sort((a, b) => state.responses[a.id].followDate.localeCompare(state.responses[b.id].followDate));
  $('summaryBack').dataset.nav = state.viewOnly ? 'audits' : 'audit';
  $('summaryContent').innerHTML = `
    <div class="card"><b>${esc(state.meta.premis || 'Premis belum diisi')}</b><br><small style="color:var(--muted)">${esc(state.meta.program)} · ${esc(state.meta.jenis)} · ${esc(state.meta.tarikh)} · ${esc(state.meta.auditor || '-')}</small></div>
    ${s.unanswered ? `<div class="warn-card">⚠ ${s.unanswered} item belum dinilai. Skor dikira daripada ${s.assessed} item yang telah dinilai (tidak termasuk N/A).</div>` : ''}
    <div class="summary-hero"><div class="score-card"><span class="eyebrow">SKOR PEMATUHAN</span><div class="score-number">${s.score}%</div><b>${s.patuh}/${s.assessed} item patuh · ${s.na} N/A</b></div><div class="risk-card"><span class="eyebrow">DEMERIT RISIKO</span><div class="risk-number">${s.demerit}</div><b>${level}</b></div></div>
    <div class="card"><h3>Penemuan Utama (${s.np.length})</h3><div class="summary-list">${s.np.map(q => { const r = state.responses[q.id]; return `<div class="list-card"><div><b>${esc(q.code)} · ${esc(q.section_name)}</b><br><small>${esc(r.note || 'Tidak patuh')}</small>${r.directiveText ? `<br><small><b>Arahan:</b> ${esc(r.directiveText)}${r.dueDate ? ' · sebelum ' + esc(r.dueDate) : ''}</small>` : ''}</div><span class="status-pill fail">${r.demerit || 0} demerit</span></div>`; }).join('') || '<p>Tiada ketidakpatuhan direkodkan.</p>'}</div></div>
    <div class="card"><h3>Rujukan Perundangan Berpotensi</h3>${legal.length ? '<ul>' + legal.map(x => `<li>Peraturan ${esc(x)} PPKM 2009 — ${esc(legalTitle(x))}</li>`).join('') + '</ul>' : '<p>Tiada.</p>'}<p style="color:#64736f;font-size:12px">Rujukan perlu disahkan oleh Pegawai Diberi Kuasa sebelum tindakan penguatkuasaan.</p></div>
    <div class="card"><h3>Susulan</h3>${fups.map(q => `<div class="list-card"><div><b>${esc(q.code)}</b><br><small>${esc(state.responses[q.id].directiveType)} · susulan ${esc(state.responses[q.id].followDate)}</small></div><span>›</span></div>`).join('') || '<p>Tiada susulan dijadualkan.</p>'}
    ${state.viewOnly ? '' : '<button class="primary wide" id="finalSaveBtn">Simpan & Jana Rekod Audit</button>'}
    <button class="ghost wide" id="printBtn" style="margin-top:10px">Cetak / Simpan PDF</button></div>`;
  $('finalSaveBtn') && ($('finalSaveBtn').onclick = finalSave);
  $('printBtn').onclick = () => window.print();
  show('summary');
}

async function finalSave() {
  captureMeta();
  if (!state.meta.premis || !state.meta.auditor) { toast('Isi nama premis dan auditor dahulu'); show('audit'); $(state.meta.premis ? 'auditor' : 'premis').focus(); return; }
  const s = computeStats(state.checklist, state.responses);
  if (s.unanswered && !confirm(`${s.unanswered} item belum dinilai. Simpan sebagai audit selesai juga?`)) return;
  const rec = { meta: { ...state.meta, status: 'COMPLETED', compliance: s.score, demerit_total: s.demerit, completed_at: new Date().toISOString() }, responses: state.responses, saved_at: new Date().toISOString() };
  const h = readLS(LS_HISTORY, []).filter(x => x.meta?.audit_id !== rec.meta.audit_id); // elak duplikasi
  h.unshift(rec); writeLS(LS_HISTORY, h.slice(0, 100));
  const d = readLS(LS_DRAFT, null); if (d?.meta?.audit_id === rec.meta.audit_id) localStorage.removeItem(LS_DRAFT);
  markPending(rec);
  if (navigator.onLine && IHKApi.configured()) { toast('Menyimpan ke backend...'); await syncAll(true); }
  else toast('Audit disimpan pada peranti — akan sync bila online');
  state.viewOnly = true; showSummary(); loadDashboard();
}

/* ---------- Senarai ---------- */
function renderList(type) {
  const titles = { audits: ['AUDIT', 'Audit Saya'], directives: ['TINDAKAN', 'Arahan Aktif'], followups: ['SUSULAN', 'Pemeriksaan Susulan'], reports: ['LAPORAN', 'Laporan & Statistik'] };
  $('listEyebrow').textContent = titles[type][0]; $('listTitle').textContent = titles[type][1];
  const h = readLS(LS_HISTORY, []), d = readLS(LS_DRAFT, null), pend = readLS(LS_PENDING, {}), t = today();
  let html = '';
  if (type === 'audits') {
    const arr = [...(d?.meta ? [{ ...d, draft: true }] : []), ...h];
    html = arr.map((x, i) => `<div class="list-card clickable" data-open="${x.draft ? 'draft' : i - (d?.meta ? 1 : 0)}"><div><b>${esc(x.meta?.premis || 'Premis belum diisi')}</b><br><small>${esc(x.meta?.program || '-')} · ${esc(x.meta?.tarikh || '-')}${x.meta?.compliance !== undefined ? ' · ' + x.meta.compliance + '%' : ''}${pend[x.meta?.audit_id] ? ' · belum sync' : ''}</small></div><span class="status-pill ${x.draft ? 'draft' : 'pass'}">${x.draft ? 'DRAF' : 'SELESAI'}</span></div>`).join('') || '<div class="card">Tiada rekod audit. Mula dengan "Audit Baharu".</div>';
  }
  if (type === 'directives') {
    const rows = h.flatMap(x => Object.values(x.responses || {}).filter(r => r.status === 'Tidak Patuh').map(r => ({ x, r }))).sort((a, b) => (a.r.dueDate || '9').localeCompare(b.r.dueDate || '9'));
    html = rows.map(({ x, r }) => { const od = r.dueDate && r.dueDate < t; return `<div class="list-card"><div><b>${esc(r.directiveType || 'Arahan Pembetulan')}</b><br><small>${esc(x.meta?.premis || '-')} · tarikh akhir ${esc(r.dueDate || '-')}</small>${r.directiveText ? `<br><small>${esc(r.directiveText)}</small>` : ''}</div><span class="status-pill ${od ? 'overdue' : 'open'}">${od ? 'LEWAT' : 'OPEN'}</span></div>`; }).join('') || '<div class="card">Tiada arahan aktif.</div>';
  }
  if (type === 'followups') {
    const rows = h.flatMap(x => Object.values(x.responses || {}).filter(r => r.status === 'Tidak Patuh' && r.followDate).map(r => ({ x, r }))).sort((a, b) => a.r.followDate.localeCompare(b.r.followDate));
    html = rows.map(({ x, r }) => `<div class="list-card"><div><b>${esc(x.meta?.premis || '-')}</b><br><small>${esc(r.followDate)} · ${esc(r.directiveType || '')}</small></div><span class="status-pill ${r.followDate === t ? 'open' : r.followDate < t ? 'overdue' : ''}">${r.followDate === t ? 'HARI INI' : r.followDate < t ? 'LEPAS' : 'AKAN DATANG'}</span></div>`).join('') || '<div class="card">Tiada pemeriksaan susulan.</div>';
  }
  if (type === 'reports') {
    const np = h.reduce((a, x) => a + Object.values(x.responses || {}).filter(r => r.status === 'Tidak Patuh').length, 0);
    const avg = h.length ? Math.round(h.reduce((a, x) => a + (Number(x.meta?.compliance) || 0), 0) / h.length) : 0;
    html = `<div class="summary-hero"><div class="score-card"><span class="eyebrow">JUMLAH AUDIT</span><div class="score-number">${h.length}</div><b>Purata pematuhan ${avg}%</b></div><div class="risk-card"><span class="eyebrow">PENEMUAN</span><div class="risk-number">${np}</div><b>Ketidakpatuhan</b></div></div>
      <div class="card"><b>${Object.keys(pend).length} rekod belum sync</b><br><small style="color:var(--muted)">${IHKApi.configured() ? 'Tekan untuk sync sekarang.' : 'API_URL belum diset dalam config.js.'}</small><br><button class="secondary" id="syncNowBtn" style="margin-top:10px" ${IHKApi.configured() ? '' : 'disabled'}>Sync sekarang</button></div>`;
  }
  $('listContent').innerHTML = html; show('list');
  $('syncNowBtn') && ($('syncNowBtn').onclick = () => syncAll(true).then(() => renderList('reports')));
  qa('[data-open]').forEach(el => el.onclick = () => el.dataset.open === 'draft' ? resumeDraft() : openHistory(Number(el.dataset.open)));
}

async function openHistory(i) {
  const rec = readLS(LS_HISTORY, [])[i]; if (!rec) return;
  try { state.checklist = await loadChecklist(rec.meta.program); } catch (e) { toast(e.message); return; }
  state.program = rec.meta.program; state.meta = { ...rec.meta }; state.responses = rec.responses || {}; state.viewOnly = true;
  showSummary();
}

/* ---------- Dashboard ---------- */
async function loadDashboard() {
  const h = readLS(LS_HISTORY, []), d = readLS(LS_DRAFT, null), t = today();
  let open = d?.meta ? 1 : 0, dirs = 0, fup = 0, overdue = 0;
  h.forEach(x => Object.values(x.responses || {}).forEach(r => {
    if (r.status !== 'Tidak Patuh') return;
    dirs++; if (r.followDate === t) fup++; if (r.dueDate && r.dueDate < t) overdue++;
  }));
  $('statOpen').textContent = open; $('statDirectives').textContent = dirs; $('statFollowups').textContent = fup;
  $('notifDot').classList.toggle('hidden', !(fup || overdue));
  updateSyncChip();
  const remote = await IHKApi.dashboard();
  if (remote?.summary) {
    $('statOpen').textContent = remote.summary.openAudits ?? open;
    $('statDirectives').textContent = remote.summary.activeDirectives ?? dirs;
    $('statFollowups').textContent = remote.summary.followupsToday ?? fup;
    $('notifDot').classList.toggle('hidden', !((remote.summary.followupsToday || 0) + (remote.summary.overdue || 0)));
  }
}

function updateNetwork() { $('netDot').style.background = navigator.onLine ? '#1ee6a0' : '#ffb020'; updateSyncChip(); }

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Versi baharu tersedia — tutup & buka semula app'); });
    });
  }).catch(console.warn);
}

let deferred;
function installPrompt() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('installBtn').hidden = false; });
  $('installBtn').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('installBtn').hidden = true; };
}

init();
