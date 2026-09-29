import {
  countStore, getAll, get, put, putMany, importBundle, exportBundle, clearAll
} from './db.js';

const DEFAULT_CABINETS = [
  { id: 'cabinet1', name: 'Ormar 1' },
  { id: 'cabinet2a', name: 'Ormar 2A' },
  { id: 'cabinet2b', name: 'Ormar 2B' },
];

const state = {
  cabinetId: 'cabinet1',
  weekStart: startOfWeek(new Date()),
  materials: [],
  placements: [],
  snapshots: [],
  cabinets: DEFAULT_CABINETS,
  draft: new Map(),
  search: '',
  currentView: 'cabinet',
};

const el = id => document.getElementById(id);

function ymd(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDay(date) {
  return new Intl.DateTimeFormat('hr-HR', { day: '2-digit', month: '2-digit' }).format(date);
}

function formatWeekRange(start) {
  const end = addDays(start, 6);
  const f = d => new Intl.DateTimeFormat('hr-HR', { day:'2-digit', month:'2-digit', year:'numeric' }).format(d);
  return `${f(start)} – ${f(end)}`;
}

function currentCabinet() {
  return state.cabinets.find(c => c.id === state.cabinetId) || state.cabinets[0];
}

function snapshotKey(date, cabinetId, code) {
  return `${date}|${cabinetId}|${code}`;
}

function activePlacement(p, dateStr) {
  return p.cabinetId === state.cabinetId && p.activeFrom <= dateStr && (!p.activeTo || p.activeTo >= dateStr);
}

function latestSnapshotBefore(code, cabinetId, dateStr) {
  let best = null;
  for (const s of state.snapshots) {
    if (s.materialCode !== code || s.cabinetId !== cabinetId || s.date > dateStr) continue;
    if (!best || s.date > best.date) best = s;
  }
  return best;
}

function qtyFor(dateStr, cabinetId, code) {
  const k = snapshotKey(dateStr, cabinetId, code);
  if (state.draft.has(k)) return state.draft.get(k);
  const found = state.snapshots.find(s => s.id === k);
  return found ? found.quantity : '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function downloadFile(filename, content, type='application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function showToast(message, tone='ok') {
  const t = el('toast');
  t.textContent = message;
  t.dataset.tone = tone;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setDirty(on=true) {
  el('saveBtn').classList.toggle('dirty', on && state.draft.size > 0);
  el('saveBtn').disabled = state.draft.size === 0;
  el('unsaved').textContent = state.draft.size ? `${state.draft.size} nespremljenih izmjena` : 'Sve spremljeno';
}

async function loadAll() {
  state.materials = await getAll('materials');
  state.placements = await getAll('placements');
  state.snapshots = await getAll('snapshots');
  state.cabinets = (await get('settings', 'cabinets'))?.value || DEFAULT_CABINETS;
  if (!state.cabinets.some(c => c.id === state.cabinetId)) state.cabinetId = state.cabinets[0].id;
  renderDrawer();
  render();
}

function renderDrawer() {
  const box = el('cabinetNav');
  box.innerHTML = state.cabinets.map(c => `
    <button class="drawer-link ${c.id===state.cabinetId && state.currentView==='cabinet' ? 'active':''}" data-cabinet="${escapeHtml(c.id)}">
      <span class="drawer-dot"></span><span>${escapeHtml(c.name)}</span>
    </button>`).join('');
  box.querySelectorAll('[data-cabinet]').forEach(btn => btn.addEventListener('click', () => {
    state.cabinetId = btn.dataset.cabinet;
    state.currentView = 'cabinet';
    closeDrawer();
    renderDrawer();
    render();
  }));
}

function openDrawer() {
  el('drawer').classList.add('open');
  el('scrim').classList.add('show');
}
function closeDrawer() {
  el('drawer').classList.remove('open');
  el('scrim').classList.remove('show');
}

function currentActiveMaterials() {
  const start = ymd(state.weekStart);
  const end = ymd(addDays(state.weekStart, 6));
  const codes = new Set(state.placements.filter(p => p.cabinetId === state.cabinetId && p.activeFrom <= end && (!p.activeTo || p.activeTo >= start)).map(p => p.materialCode));
  const q = state.search.trim().toLowerCase();
  return state.materials
    .filter(m => codes.has(m.code))
    .filter(m => !q || [m.code,m.material,m.system,m.aic,m.sourceDescription].some(v => String(v||'').toLowerCase().includes(q)))
    .sort((a,b) => a.code.localeCompare(b.code));
}

function render() {
  el('viewTitle').textContent = currentCabinet().name;
  el('weekLabel').textContent = formatWeekRange(state.weekStart);
  el('searchInput').value = state.search;
  el('todayBtn').disabled = ymd(startOfWeek(new Date())) === ymd(state.weekStart);
  document.querySelectorAll('.view-panel').forEach(v => v.hidden = true);
  if (state.currentView === 'cabinet') {
    el('cabinetView').hidden = false;
    renderCabinet();
  } else if (state.currentView === 'materials') {
    el('materialsView').hidden = false;
    renderMaterialsView();
  } else if (state.currentView === 'data') {
    el('dataView').hidden = false;
    renderDataView();
  }
}

function isActiveOnDate(code, cabinetId, dateStr) {
  return state.placements.some(p => p.materialCode===code && p.cabinetId===cabinetId && p.activeFrom<=dateStr && (!p.activeTo || p.activeTo>=dateStr));
}

function renderCabinet() {
  const mats = currentActiveMaterials();
  const weekDates = Array.from({length:7}, (_,i)=>addDays(state.weekStart,i));
  const today = ymd(new Date());

  let totalQty = 0;
  let totalKg = 0;
  for (const m of mats) {
    const latest = latestSnapshotBefore(m.code, state.cabinetId, today);
    const q = latest?.quantity ?? 0;
    totalQty += Number(q)||0;
    if ((m.unit||'kg').toLowerCase()==='kg') totalKg += (Number(m.weight)||0)*(Number(q)||0);
  }
  el('kpiMaterials').textContent = mats.length;
  el('kpiQty').textContent = totalQty;
  el('kpiWeight').textContent = `${Number(totalKg.toFixed(2))} kg`;

  const headDates = weekDates.map(d => {
    const ds=ymd(d); return `<th class="date-head ${ds===today?'today':''}"><span>${formatDay(d)}</span><small>${['Ned','Pon','Uto','Sri','Čet','Pet','Sub'][d.getDay()]}</small></th>`;
  }).join('');

  const rows = mats.map(m => {
    const dateCells = weekDates.map(d => {
      const ds=ymd(d);
      if (!isActiveOnDate(m.code, state.cabinetId, ds)) return `<td class="qty-cell inactive ${ds===today?'today':''}">—</td>`;
      const k=snapshotKey(ds,state.cabinetId,m.code); const val=qtyFor(ds,state.cabinetId,m.code);
      return `<td class="qty-cell ${ds===today?'today':''}" data-cell="${escapeHtml(k)}">
        <div class="qty-control">
          <button class="qty-btn minus" type="button" data-k="${escapeHtml(k)}" aria-label="Smanji">−</button>
          <input class="qty-input" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="${escapeHtml(val)}" data-k="${escapeHtml(k)}" aria-label="Količina ${escapeHtml(ds)}">
          <button class="qty-btn plus" type="button" data-k="${escapeHtml(k)}" aria-label="Povećaj">+</button>
        </div>
      </td>`;
    }).join('');
    const weight = m.weight == null ? '—' : `${Number(m.weight)} ${escapeHtml(m.unit||'kg')}`;
    return `<tr>
      <td class="code-cell">${escapeHtml(m.code)}</td>
      <td class="material-cell">
        <div class="material-name">${escapeHtml(m.material || m.sourceDescription)}</div>
        <div class="mobile-meta"><span>Sistem ${escapeHtml(m.system||'—')}</span><span>AIC ${escapeHtml(m.aic||'—')}</span><span>${weight}</span></div>
      </td>
      <td class="desktop-col">${escapeHtml(m.system||'—')}</td>
      <td class="desktop-col">${escapeHtml(m.aic||'—')}</td>
      <td class="desktop-col">${weight}</td>
      ${dateCells}
      <td class="actions-cell"><button class="icon-btn archive" data-code="${escapeHtml(m.code)}" title="Ukloni iz ormara">⋮</button></td>
    </tr>`;
  }).join('');

  el('cabinetTable').innerHTML = `
    <thead><tr><th class="code-cell">Šifra</th><th class="material-cell">Materijal</th><th class="desktop-col">Sistem</th><th class="desktop-col">AIC</th><th class="desktop-col">Težina</th>${headDates}<th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="13" class="empty">Nema aktivnih materijala u ovom ormaru.</td></tr>`}</tbody>`;

  bindQuantityControls();
  el('cabinetTable').querySelectorAll('.archive').forEach(b => b.addEventListener('click', () => openArchiveDialog(b.dataset.code)));
  setDirty(false);
}

function bindQuantityControls() {
  document.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('input', () => {
      const v = input.value === '' ? '' : Math.max(0, Math.floor(Number(input.value)||0));
      input.value = v;
      state.draft.set(input.dataset.k, v);
      setDirty(true);
    });
  });
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.querySelector(`.qty-input[data-k="${CSS.escape(btn.dataset.k)}"]`);
      const cur = input.value === '' ? 0 : Number(input.value)||0;
      const next = Math.max(0, cur + (btn.classList.contains('plus') ? 1 : -1));
      input.value = next;
      state.draft.set(btn.dataset.k, next);
      setDirty(true);
    });
  });
}

async function saveDraft() {
  if (!state.draft.size) return;
  const rows=[];
  for (const [id, quantity] of state.draft.entries()) {
    const [date,cabinetId,materialCode]=id.split('|');
    if (quantity === '') continue;
    rows.push({ id, date, cabinetId, materialCode, quantity:Number(quantity) });
  }
  await putMany('snapshots', rows);
  for (const r of rows) {
    const idx = state.snapshots.findIndex(x=>x.id===r.id);
    if (idx>=0) state.snapshots[idx]=r; else state.snapshots.push(r);
  }
  state.draft.clear();
  setDirty(false);
  showToast('Stanje je spremljeno.');
  renderCabinet();
}

async function copyLatestToToday() {
  const today=ymd(new Date());
  const start=ymd(state.weekStart), end=ymd(addDays(state.weekStart,6));
  if (today < start || today > end) {
    showToast('Prvo otvori tjedan koji sadrži današnji datum.', 'warn');
    return;
  }
  const mats=currentActiveMaterials();
  for (const m of mats) {
    const existing = state.snapshots.find(s=>s.id===snapshotKey(today,state.cabinetId,m.code));
    if (existing) continue;
    const latest=latestSnapshotBefore(m.code,state.cabinetId,today);
    if (latest) state.draft.set(snapshotKey(today,state.cabinetId,m.code), latest.quantity);
  }
  renderCabinet();
  setDirty(true);
  showToast('Zadnje stanje preneseno je u današnji stupac. Provjeri i spremi.');
}

function renderMaterialsView() {
  el('viewTitle').textContent='Baza materijala';
  const q=(el('masterSearch')?.value||'').trim().toLowerCase();
  const rows=state.materials
    .filter(m=>!q || [m.code,m.material,m.system,m.aic,m.sourceDescription].some(v=>String(v||'').toLowerCase().includes(q)))
    .sort((a,b)=>a.code.localeCompare(b.code))
    .slice(0,500);
  el('masterTable').innerHTML=`<thead><tr><th>Šifra</th><th>Materijal</th><th>Sistem</th><th>AIC</th><th>Težina</th><th></th></tr></thead><tbody>${rows.map(m=>`<tr><td>${escapeHtml(m.code)}</td><td>${escapeHtml(m.material||'—')}</td><td>${escapeHtml(m.system||'—')}</td><td>${escapeHtml(m.aic||'—')}</td><td>${m.weight??'—'} ${escapeHtml(m.unit||'')}</td><td><button class="icon-btn edit-master" data-code="${escapeHtml(m.code)}">Uredi</button></td></tr>`).join('')}</tbody>`;
  el('masterTable').querySelectorAll('.edit-master').forEach(b=>b.addEventListener('click',()=>openMasterDialog(b.dataset.code)));
}

function renderDataView() {
  el('viewTitle').textContent='Backup i podaci';
  Promise.all([countStore('materials'),countStore('placements'),countStore('snapshots')]).then(([m,p,s])=>{
    el('dataStats').textContent=`${m} materijala · ${p} zapisa ormara · ${s} dnevnih stanja`;
  });
}

function openAddDialog() {
  const dlg=el('addDialog');
  const activeCodes=new Set(state.placements.filter(p=>p.cabinetId===state.cabinetId && !p.activeTo).map(p=>p.materialCode));
  const options=state.materials.filter(m=>!activeCodes.has(m.code)).sort((a,b)=>a.code.localeCompare(b.code));
  el('addMaterialCode').innerHTML='<option value="">Odaberi šifru…</option>'+options.map(m=>`<option value="${escapeHtml(m.code)}">${escapeHtml(m.code)} — ${escapeHtml(m.material||m.sourceDescription)}</option>`).join('');
  el('addCabinetName').textContent=currentCabinet().name;
  el('addQty').value='0';
  el('addDate').value=ymd(new Date());
  el('addPreview').innerHTML='';
  dlg.showModal();
}

function previewAdd(code) {
  const m=state.materials.find(x=>x.code===code);
  el('addPreview').innerHTML=m?`<strong>${escapeHtml(m.material)}</strong><span>Sistem: ${escapeHtml(m.system||'—')}</span><span>AIC: ${escapeHtml(m.aic||'—')}</span><span>Težina: ${m.weight??'—'} ${escapeHtml(m.unit||'')}</span>`:'';
}

async function confirmAdd() {
  const code=el('addMaterialCode').value;
  if (!code) return showToast('Odaberi materijal.', 'warn');
  const date=el('addDate').value || ymd(new Date());
  const qty=Math.max(0,Math.floor(Number(el('addQty').value)||0));
  const placement={id:`${state.cabinetId}|${code}|${date}`,cabinetId:state.cabinetId,materialCode:code,activeFrom:date,activeTo:null};
  const snap={id:snapshotKey(date,state.cabinetId,code),date,cabinetId:state.cabinetId,materialCode:code,quantity:qty};
  await put('placements',placement); await put('snapshots',snap);
  state.placements.push(placement); state.snapshots.push(snap);
  el('addDialog').close(); showToast('Materijal je dodan u ormar.'); renderCabinet();
}

function openArchiveDialog(code) {
  const m=state.materials.find(x=>x.code===code);
  el('archiveCode').value=code;
  el('archiveText').textContent=`${code} — ${m?.material||''}`;
  el('archiveDate').value=ymd(new Date());
  el('archiveDialog').showModal();
}

async function confirmArchive() {
  const code=el('archiveCode').value; const date=el('archiveDate').value||ymd(new Date());
  const p=state.placements.filter(x=>x.cabinetId===state.cabinetId&&x.materialCode===code&&!x.activeTo).sort((a,b)=>b.activeFrom.localeCompare(a.activeFrom))[0];
  if (!p) return el('archiveDialog').close();
  p.activeTo=date;
  await put('placements',p);
  el('archiveDialog').close(); showToast('Materijal je uklonjen iz aktivnog ormara. Povijest je sačuvana.');
  await loadAll();
}

function openMasterDialog(code='') {
  const m=state.materials.find(x=>x.code===code)||{code:'',material:'',system:'',aic:'',weight:'',unit:'kg',sourceDescription:'',active:true};
  el('masterOldCode').value=m.code;
  el('masterCode').value=m.code;
  el('masterMaterial').value=m.material||'';
  el('masterSystem').value=m.system||'';
  el('masterAic').value=m.aic||'';
  el('masterWeight').value=m.weight??'';
  el('masterUnit').value=m.unit||'kg';
  el('masterDialogTitle').textContent=code?'Uredi materijal':'Dodaj u bazu materijala';
  el('masterDialog').showModal();
}

async function saveMaster() {
  const old=el('masterOldCode').value.trim();
  const code=el('masterCode').value.trim();
  if (!/^\d{6}$/.test(code)) return showToast('Šifra mora imati 6 znamenki.', 'warn');
  if (old && old!==code) return showToast('Promjena postojeće šifre nije dopuštena. Dodaj novi zapis.', 'warn');
  const m={
    code,
    material:el('masterMaterial').value.trim(),
    system:el('masterSystem').value.trim(),
    aic:el('masterAic').value.trim(),
    weight:el('masterWeight').value===''?null:Number(el('masterWeight').value),
    unit:el('masterUnit').value,
    sourceDescription:'Ručno dodano/uređeno u ENIKON Cabinet Control',
    active:true
  };
  await put('materials',m);
  const idx=state.materials.findIndex(x=>x.code===code); if(idx>=0)state.materials[idx]=m;else state.materials.push(m);
  el('masterDialog').close(); showToast('Baza materijala je spremljena.'); renderMaterialsView();
}

async function handleImportFile(file, replace=true) {
  const text=await file.text();
  const bundle=JSON.parse(text);
  await importBundle(bundle,{replace});
  el('firstRun').hidden=true;
  await loadAll();
  showToast('Podaci su uspješno uvezeni.');
}

async function exportBackup() {
  const bundle=await exportBundle();
  const stamp=ymd(new Date());
  downloadFile(`ENIKON_Cabinet_Backup_${stamp}.json`,JSON.stringify(bundle,null,2));
}

async function exportCsv() {
  const mats=new Map(state.materials.map(m=>[m.code,m]));
  const cabs=new Map(state.cabinets.map(c=>[c.id,c.name]));
  const rows=[['Datum','Ormar','Šifra','Materijal','Sistem','AIC','Težina','Jedinica','Količina']];
  [...state.snapshots].sort((a,b)=>a.date.localeCompare(b.date)||a.cabinetId.localeCompare(b.cabinetId)||a.materialCode.localeCompare(b.materialCode)).forEach(s=>{
    const m=mats.get(s.materialCode)||{};
    rows.push([s.date,cabs.get(s.cabinetId)||s.cabinetId,s.materialCode,m.material||'',m.system||'',m.aic||'',m.weight??'',m.unit||'',s.quantity]);
  });
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(';')).join('\r\n');
  downloadFile(`ENIKON_Cabinet_Povijest_${ymd(new Date())}.csv`,'\uFEFF'+csv,'text/csv;charset=utf-8');
}

function wireEvents() {
  el('menuBtn').addEventListener('click',openDrawer); el('drawerClose').addEventListener('click',closeDrawer); el('scrim').addEventListener('click',closeDrawer);
  el('prevWeek').addEventListener('click',()=>{state.weekStart=addDays(state.weekStart,-7);render();});
  el('nextWeek').addEventListener('click',()=>{state.weekStart=addDays(state.weekStart,7);render();});
  el('todayBtn').addEventListener('click',()=>{state.weekStart=startOfWeek(new Date());render();});
  el('searchInput').addEventListener('input',e=>{state.search=e.target.value;renderCabinet();});
  el('saveBtn').addEventListener('click',saveDraft);
  el('copyTodayBtn').addEventListener('click',copyLatestToToday);
  el('addBtn').addEventListener('click',openAddDialog);
  el('addMaterialCode').addEventListener('change',e=>previewAdd(e.target.value));
  el('addConfirm').addEventListener('click',confirmAdd);
  el('archiveConfirm').addEventListener('click',confirmArchive);
  el('drawerMaterials').addEventListener('click',()=>{state.currentView='materials';closeDrawer();renderDrawer();render();});
  el('drawerData').addEventListener('click',()=>{state.currentView='data';closeDrawer();renderDrawer();render();});
  el('masterSearch').addEventListener('input',renderMaterialsView);
  el('masterAdd').addEventListener('click',()=>openMasterDialog());
  el('masterSave').addEventListener('click',saveMaster);
  el('firstImportBtn').addEventListener('click',()=>el('importFile').click());
  el('importBtn').addEventListener('click',()=>el('importFile').click());
  el('importFile').addEventListener('change',async e=>{if(e.target.files[0]){try{await handleImportFile(e.target.files[0],true);}catch(err){showToast(err.message,'error');} e.target.value='';}});
  el('exportBackup').addEventListener('click',exportBackup);
  el('exportCsv').addEventListener('click',exportCsv);
  el('resetBtn').addEventListener('click',()=>el('resetDialog').showModal());
  el('resetConfirm').addEventListener('click',async()=>{if(el('resetWord').value!=='OBRISI')return;await clearAll();el('resetDialog').close();state.draft.clear();await loadAll();showToast('Svi lokalni podaci su obrisani.','warn');});
  document.querySelectorAll('dialog [data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
}

async function init() {
  wireEvents();
  const count=await countStore('materials');
  if (!count) {
    el('firstRun').hidden=false;
  }
  await loadAll();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}

init().catch(err=>{
  console.error(err);
  el('fatal').hidden=false;
  el('fatal').textContent='Greška pri pokretanju aplikacije: '+err.message;
});
