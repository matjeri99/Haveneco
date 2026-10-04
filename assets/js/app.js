const $=id=>document.getElementById(id);
const qa=s=>[...document.querySelectorAll(s)];
const state={program:'MeSTI',auditType:'Rutin',checklist:[],risk:[],legal:[],responses:{},current:null,meta:{},photos:{}};
const VIEWS=['home','program','audit','list','summary'];
const LS_DRAFT='IHK_AUDIT_DRAFT_V3',LS_HISTORY='IHK_AUDIT_HISTORY_V3';
function esc(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function uid(){return crypto.randomUUID?crypto.randomUUID():'id-'+Date.now()+'-'+Math.random().toString(16).slice(2)}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2200)}
function show(name){VIEWS.forEach(v=>$('view-'+v)?.classList.toggle('active',v===name));scrollTo({top:0,behavior:'smooth'})}
function today(){return new Date().toISOString().slice(0,10)}
function addDays(n){const d=new Date();d.setDate(d.getDate()+Number(n));return d.toISOString().slice(0,10)}
async function init(){
  [state.risk,state.legal]=await Promise.all([fetch('risk-master.json').then(r=>r.json()),fetch('legal-master.json').then(r=>r.json())]);
  bind(); renderProgramPicker(); updateNetwork(); loadDashboard(); registerSW(); installPrompt();
}
function bind(){
  qa('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
  qa('[data-program]').forEach(b=>b.addEventListener('click',()=>{state.program=b.dataset.program;startProgramFlow()}));
  qa('[data-action="new"]').forEach(b=>b.addEventListener('click',()=>startProgramFlow()));
  $('continueAuditBtn').onclick=beginAudit;$('saveDraftBtn').onclick=saveDraft;$('summaryBtn').onclick=showSummary;$('closeFinding').onclick=closeFinding;$('saveFindingBtn').onclick=saveFinding;
  qa('[data-status]').forEach(b=>b.onclick=()=>setStatus(b.dataset.status));
  qa('[data-directive]').forEach(b=>b.onclick=()=>selectDirective(b.dataset.directive));
  $('duePreset').onchange=()=>{if($('duePreset').value!=='custom')$('dueDate').value=addDays($('duePreset').value)};
  $('photoInput').onchange=e=>{state.photos[state.current?.id]=[...e.target.files].map(f=>({name:f.name,size:f.size}));toast(`${e.target.files.length} gambar dipilih`) };
  window.addEventListener('online',()=>{updateNetwork();flushPending()});window.addEventListener('offline',updateNetwork);
}
function navigate(name){
  if(name==='home')return show('home'); if(name==='program')return show('program'); if(name==='audit')return show('audit');
  if(['audits','directives','followups','reports'].includes(name)) return renderList(name);
}
function startProgramFlow(){renderProgramPicker();show('program')}
function renderProgramPicker(){
  const programs=[['MeSTI','Makanan Selamat Tanggungjawab Industri','mesti'],['GMP','Amalan Pengilangan Baik','gmp'],['BeSS','Bersih, Selamat dan Sihat','bess'],['HACCP','Analisis Bahaya & Kawalan Titik Kritikal','haccp']];
  $('programPicker').innerHTML=programs.map(([p,d,c])=>`<button class="program-card ${p===state.program?'selected':''}" data-pick-program="${p}"><span class="program-logo ${c}">${p==='BeSS'?'☘':p}</span><span><b>${p}</b><small>${d}</small></span><i>›</i></button>`).join('');
  qa('[data-pick-program]').forEach(b=>b.onclick=()=>{state.program=b.dataset.pickProgram;renderProgramPicker()});
  qa('[data-type]').forEach(b=>b.onclick=()=>{state.auditType=b.dataset.type;qa('[data-type]').forEach(x=>x.classList.toggle('selected',x===b))});
}
async function beginAudit(){
  if(state.program!=='MeSTI'){toast(`${state.program}: checklist master belum dimasukkan`);return}
  state.checklist=await fetch('mesti-checklist.json').then(r=>r.json());state.responses={};state.meta={program:state.program,jenis:state.auditType,audit_id:uid()};
  const d=JSON.parse(localStorage.getItem(LS_DRAFT)||'null');if(d?.meta?.program===state.program && confirm('Terdapat draf MeSTI. Sambung draf tersebut?')){state.meta=d.meta||state.meta;state.responses=d.responses||{}}
  $('auditProgramLabel').textContent=state.program;$('auditTitle').textContent=`Pemeriksaan ${state.program}`;$('jenis').value=state.meta.jenis||state.auditType;$('tarikh').value=state.meta.tarikh||today();$('premis').value=state.meta.premis||'';$('auditor').value=state.meta.auditor||'';
  renderSections();show('audit')
}
function renderSections(){
  const groups={};state.checklist.forEach(q=>(groups[q.section]??=[]).push(q));
  $('sectionList').innerHTML=Object.entries(groups).map(([s,qs])=>{const done=qs.filter(q=>state.responses[q.id]?.status).length;return `<article class="section-card"><button class="section-btn" data-sec="${s}"><span><b>${s}. ${esc(qs[0].section_name)}</b><br><span>${done}/${qs.length} item selesai</span></span><span>⌄</span></button><div class="section-body ${done?'':'hidden'}" id="sec-${s}">${qs.map(q=>questionHtml(q)).join('')}</div></article>`}).join('');
  qa('[data-sec]').forEach(b=>b.onclick=()=>document.getElementById('sec-'+b.dataset.sec).classList.toggle('hidden'));
  qa('[data-q]').forEach(b=>b.onclick=()=>openFinding(b.dataset.q));updateProgress();
}
function questionHtml(q){const r=state.responses[q.id]||{};let cls=r.status==='Patuh'?'pass':r.status==='Tidak Patuh'?'fail':r.status==='N/A'?'na':'';return `<button class="question-item" data-q="${q.id}"><div><span class="qcode">${q.code}</span>${esc(q.question)}<div class="qmeta">${r.demerit?`Demerit ${r.demerit} · `:''}${r.directiveType||''}</div></div><span class="status-pill ${cls}">${r.status||'Belum dinilai'}</span></button>`}
function updateProgress(){const done=state.checklist.filter(q=>state.responses[q.id]?.status).length;const p=state.checklist.length?Math.round(done/state.checklist.length*100):0;$('progressText').textContent=`${done}/${state.checklist.length} item · ${p}%`;$('progressBar').style.width=p+'%'}
function openFinding(id){
  state.current=state.checklist.find(q=>q.id===id);const r=state.responses[id]||{};$('findingCode').textContent=`${state.current.code} · ${state.current.section_name}`;$('findingQ').textContent=state.current.question;$('findingNote').value=r.note||'';$('findingEvidence').value=r.evidence||'';
  $('riskSelect').innerHTML='<option value="">-- pilih jika berkaitan --</option>'+state.risk.map(x=>`<option value="${x.risk_id}" ${r.risk_id===x.risk_id?'selected':''}>${x.risk_id} · ${x.domain} · ${x.demerit} markah</option>`).join('');
  $('legalSelect').innerHTML=state.legal.map(x=>`<option value="${x.reg}" ${(r.legal||[]).includes(x.reg)?'selected':''}>Per. ${x.reg} — ${esc(x.title)}</option>`).join('');
  $('directiveText').value=r.directiveText||'';$('dueDate').value=r.dueDate||'';$('followDate').value=r.followDate||'';$('section10').checked=!!r.section10;state.directiveType=r.directiveType||'Arahan Pembetulan';
  qa('[data-status]').forEach(b=>b.classList.toggle('active',b.dataset.status===r.status));qa('[data-directive]').forEach(b=>b.classList.toggle('selected',b.dataset.directive===state.directiveType));$('nonComplianceBlock').classList.toggle('hidden',r.status!=='Tidak Patuh');$('findingDrawer').classList.remove('hidden')
}
function closeFinding(){$('findingDrawer').classList.add('hidden');state.current=null}
function setStatus(st){if(!state.current)return;const r=state.responses[state.current.id]||{};r.status=st;state.responses[state.current.id]=r;qa('[data-status]').forEach(b=>b.classList.toggle('active',b.dataset.status===st));$('nonComplianceBlock').classList.toggle('hidden',st!=='Tidak Patuh')}
function selectDirective(v){state.directiveType=v;qa('[data-directive]').forEach(b=>b.classList.toggle('selected',b.dataset.directive===v))}
function saveFinding(){
  if(!state.current)return;const r=state.responses[state.current.id]||{};if(!r.status){toast('Pilih status item dahulu');return}r.note=$('findingNote').value;r.evidence=$('findingEvidence').value;
  if(r.status==='Tidak Patuh'){r.risk_id=$('riskSelect').value;const rr=state.risk.find(x=>x.risk_id===r.risk_id);r.demerit=Number(rr?.demerit||0);r.legal=[...$('legalSelect').selectedOptions].map(o=>o.value);r.directiveType=state.directiveType;r.directiveText=$('directiveText').value;r.dueDate=$('dueDate').value;r.followDate=$('followDate').value;r.section10=$('section10').checked;r.directive_id=r.directive_id||uid();}else{delete r.risk_id;delete r.demerit;delete r.legal;delete r.directiveText;}
  state.responses[state.current.id]=r;saveDraft(false);closeFinding();renderSections();toast('Penemuan disimpan')
}
function captureMeta(){state.meta={...state.meta,premis:$('premis').value,tarikh:$('tarikh').value,auditor:$('auditor').value,jenis:$('jenis').value,program:state.program,audit_id:state.meta.audit_id||uid(),updated_at:new Date().toISOString()}}
async function saveDraft(showToast=true){captureMeta();const rec={meta:state.meta,responses:state.responses};localStorage.setItem(LS_DRAFT,JSON.stringify(rec));if(showToast)toast('Draf disimpan pada peranti');if(navigator.onLine)queueSync(rec)}
async function queueSync(rec){try{await IHKApi.saveAudit(rec)}catch(e){localStorage.setItem('IHK_PENDING_SYNC',JSON.stringify(rec));console.warn(e)}}
async function flushPending(){const r=JSON.parse(localStorage.getItem('IHK_PENDING_SYNC')||'null');if(!r)return;try{await IHKApi.saveAudit(r);localStorage.removeItem('IHK_PENDING_SYNC');toast('Data offline berjaya disegerakkan')}catch(e){console.warn(e)}}
function showSummary(){captureMeta();const all=state.checklist.filter(q=>state.responses[q.id]?.status);const np=all.filter(q=>state.responses[q.id]?.status==='Tidak Patuh');const na=all.filter(q=>state.responses[q.id]?.status==='N/A').length;const patuh=all.filter(q=>state.responses[q.id]?.status==='Patuh').length;const applicable=Math.max(1,state.checklist.length-na);const score=Math.round(patuh/applicable*100);const demerit=np.reduce((a,q)=>a+(state.responses[q.id]?.demerit||0),0);const legal=[...new Set(np.flatMap(q=>state.responses[q.id]?.legal||[]))];
  $('summaryContent').innerHTML=`<div class="summary-hero"><div class="score-card"><span class="eyebrow">SKOR PEMATUHAN</span><div class="score-number">${score}%</div><b>${patuh}/${applicable} item patuh</b></div><div class="risk-card"><span class="eyebrow">DEMERIT RISIKO</span><div class="risk-number">${demerit}</div><b>${demerit>=20?'Tinggi':demerit>=10?'Sederhana':'Rendah'}</b></div></div><div class="card"><h3>Penemuan Utama</h3><div class="summary-list">${np.map(q=>{const r=state.responses[q.id];return `<div class="list-card"><div><b>${q.code} · ${esc(q.section_name)}</b><br><small>${esc(r.note||'Tidak patuh')}</small></div><span class="status-pill fail">${r.demerit||0} demerit</span></div>`}).join('')||'<p>Tiada ketidakpatuhan direkodkan.</p>'}</div></div><div class="card"><h3>Rujukan Perundangan Berpotensi</h3><p>${legal.map(x=>'Peraturan '+x).join(', ')||'Tiada.'}</p><p style="color:#64736f;font-size:12px">Rujukan perlu disahkan oleh Pegawai Diberi Kuasa sebelum tindakan penguatkuasaan.</p></div><div class="card"><h3>Susulan</h3>${np.filter(q=>state.responses[q.id]?.followDate).map(q=>`<div class="list-card"><div><b>${q.code}</b><br><small>${state.responses[q.id].directiveType} · ${state.responses[q.id].followDate}</small></div><span>›</span></div>`).join('')||'<p>Tiada susulan dijadualkan.</p>'}<button class="primary wide" id="finalSaveBtn">Simpan & Jana Rekod Audit</button></div>`;
  $('finalSaveBtn').onclick=finalSave;show('summary')
}
async function finalSave(){captureMeta();const rec={meta:{...state.meta,status:'COMPLETED'},responses:state.responses,saved_at:new Date().toISOString()};const h=JSON.parse(localStorage.getItem(LS_HISTORY)||'[]');h.unshift(rec);localStorage.setItem(LS_HISTORY,JSON.stringify(h.slice(0,100)));localStorage.removeItem(LS_DRAFT);try{await IHKApi.saveAudit(rec);toast('Audit disimpan ke backend')}catch(e){localStorage.setItem('IHK_PENDING_SYNC',JSON.stringify(rec));toast('Audit disimpan offline — akan sync kemudian')}loadDashboard()}
function renderList(type){const titles={audits:['AUDIT','Audit Saya'],directives:['TINDAKAN','Arahan Aktif'],followups:['SUSULAN','Pemeriksaan Susulan'],reports:['LAPORAN','Laporan & Statistik']};$('listEyebrow').textContent=titles[type][0];$('listTitle').textContent=titles[type][1];const h=JSON.parse(localStorage.getItem(LS_HISTORY)||'[]');const d=JSON.parse(localStorage.getItem(LS_DRAFT)||'null');let html='';
  if(type==='audits'){const arr=[...(d?[{...d,draft:true}]:[]),...h];html=arr.map(x=>`<div class="list-card"><div><b>${esc(x.meta?.premis||'Premis belum diisi')}</b><br><small>${x.meta?.program||'-'} · ${x.meta?.tarikh||'-'} · ${x.draft?'DRAF':'SELESAI'}</small></div><span>›</span></div>`).join('')||'<div class="card">Tiada rekod audit.</div>'}
  if(type==='directives'){const rows=h.flatMap(x=>Object.entries(x.responses||{}).filter(([,r])=>r.status==='Tidak Patuh').map(([id,r])=>({x,id,r})));html=rows.map(({x,r})=>`<div class="list-card"><div><b>${r.directiveType||'Arahan Pembetulan'}</b><br><small>${esc(x.meta?.premis||'-')} · due ${r.dueDate||'-'}</small></div><span class="status-pill fail">OPEN</span></div>`).join('')||'<div class="card">Tiada arahan aktif.</div>'}
  if(type==='followups'){const rows=h.flatMap(x=>Object.values(x.responses||{}).filter(r=>r.followDate).map(r=>({x,r})));html=rows.map(({x,r})=>`<div class="list-card"><div><b>${esc(x.meta?.premis||'-')}</b><br><small>${r.followDate} · ${r.directiveType||''}</small></div><span>›</span></div>`).join('')||'<div class="card">Tiada pemeriksaan susulan.</div>'}
  if(type==='reports'){html='<div class="summary-hero"><div class="score-card"><span class="eyebrow">JUMLAH AUDIT</span><div class="score-number">'+h.length+'</div><b>Rekod selesai</b></div><div class="risk-card"><span class="eyebrow">PENEMUAN</span><div class="risk-number">'+h.reduce((a,x)=>a+Object.values(x.responses||{}).filter(r=>r.status==='Tidak Patuh').length,0)+'</div><b>Ketidakpatuhan</b></div></div>'}
  $('listContent').innerHTML=html;show('list')
}
async function loadDashboard(){const h=JSON.parse(localStorage.getItem(LS_HISTORY)||'[]');const d=JSON.parse(localStorage.getItem(LS_DRAFT)||'null');let open=d?1:0,dirs=0,fup=0;h.forEach(x=>Object.values(x.responses||{}).forEach(r=>{if(r.status==='Tidak Patuh')dirs++;if(r.followDate===today())fup++}));$('statOpen').textContent=open;$('statDirectives').textContent=dirs;$('statFollowups').textContent=fup;const remote=await IHKApi.dashboard();if(remote?.summary){$('statOpen').textContent=remote.summary.openAudits??open;$('statDirectives').textContent=remote.summary.activeDirectives??dirs;$('statFollowups').textContent=remote.summary.followupsToday??fup}}
function updateNetwork(){const on=navigator.onLine;$('netDot').style.background=on?'#1ee6a0':'#ffb020';$('netText').textContent=on?'online':'offline'}
function registerSW(){if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(console.warn)}
let deferred;function installPrompt(){window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('installBtn').hidden=false});$('installBtn').onclick=async()=>{if(!deferred)return;deferred.prompt();await deferred.userChoice;deferred=null;$('installBtn').hidden=true}}
init();
