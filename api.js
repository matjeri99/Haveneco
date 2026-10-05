window.IHKApi = (() => {
  const cfg = () => window.IHK_CONFIG || {};
  const configured = () => !!cfg().API_URL && !cfg().API_URL.includes('PASTE_YOUR');

  async function call(action, payload = {}, timeoutMs = 30000) {
    if (!configured()) throw new Error('API_URL belum dikonfigurasi');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // text/plain elak CORS preflight pada Apps Script
      const res = await fetch(cfg().API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: cfg().API_TOKEN || '', payload }),
        signal: ctrl.signal,
        redirect: 'follow'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data?.ok === false) throw new Error(data.error || 'Ralat backend');
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Sambungan tamat masa');
      throw e;
    } finally { clearTimeout(t); }
  }

  async function dashboard() {
    if (!configured() || cfg().ENABLE_REMOTE_DASHBOARD === false) return null;
    try { return await call('dashboard', {}, 15000); } catch (e) { console.warn(e); return null; }
  }
  const saveAudit = record => call('saveAudit', { record });
  const list = (type, extra = {}) => call('list', { type, ...extra });
  const uploadEvidence = p => call('uploadEvidence', p, 90000);

  return { configured, call, dashboard, saveAudit, list, uploadEvidence };
})();
