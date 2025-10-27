// Main JavaScript file (consolidated and fixed)

// Initialize API if available (do not override existing)
if (!window.api) window.api = typeof API !== 'undefined' ? new API() : null;

// Simple selectors
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// Utility: debounce
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// CSV parsing and inventory persistence (projects page)
function detectDelimiter(text) {
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  const maxLen = Math.min(text.length, 5000);
  for (let i = 0; i < maxLen; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (text[i + 1] === '"') { i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++;
    if (ch === '\n') break;
  }
  let best = ','; let max = -1;
  for (const k of Object.keys(counts)) { if (counts[k] > max) { max = counts[k]; best = k; } }
  return best;
}

function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  const delim = detectDelimiter(text);
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === delim) { pushField(); }
      else if (ch === '\n') { pushField(); pushRow(); }
      else if (ch === '\r') { /* ignore CR */ }
      else { field += ch; }
    }
    i++;
  }
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  return rows;
}

// Detect the best header row within the first few lines (useful for Excel with title rows)
function findHeaderRowIndex(rows, maxScan = 20) {
  const norm = s => (s || '').toString().trim().toLowerCase();
  const wanted = [
    ['lot', 'lot #', 'lot no', 'lot number', 'lot#', 'lot_num', 'lotnum', 'lot code'],
    ['phase', 'phases'],
    ['lot area', 'size (sqm)', 'size', 'sqm'],
    ['status'],
    ['category', 'cat'],
    ['rsv date', 'reservation date', 'last updated', 'updated', 'date']
  ];
  let best = 0, scoreBest = -1;
  const limit = Math.min(rows.length, maxScan);
  for (let r = 0; r < limit; r++) {
    const hdrs = (rows[r] || []).map(norm);
    let score = 0;
    for (const group of wanted) {
      if (group.some(g => hdrs.includes(g))) score++;
    }
    if (score > scoreBest) { scoreBest = score; best = r; }
  }
  return best;
}

const INVENTORY_KEY_PREFIX = 'vhbc_inventory_';
function getInventory(project) {
  try { const raw = localStorage.getItem(INVENTORY_KEY_PREFIX + project); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function setInventory(project, lots) {
  try { localStorage.setItem(INVENTORY_KEY_PREFIX + project, JSON.stringify(lots || [])); } catch {}
}

// Per-project category price map
const PRICE_KEY_PREFIX = 'vhbc_prices_';
function priceKey(project, scope) {
  return PRICE_KEY_PREFIX + project + (scope ? ('_' + scope) : '');
}
function getPriceMap(project, scope) {
  try { const raw = localStorage.getItem(priceKey(project, scope)); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function setPriceMap(project, map, scope) {
  try { localStorage.setItem(priceKey(project, scope), JSON.stringify(map || {})); } catch {}
}

// Notifications (simple)
function showNotification(message, type = 'info') {
  const el = document.createElement('div');
  el.textContent = message;
  el.className = `vhbc-${type}`;
  Object.assign(el.style, {
    position: 'fixed', right: '20px', top: '20px', padding: '8px 12px',
    color: '#fff', background: type === 'error' ? '#e74c3c' : '#2ecc71', zIndex: 9999, borderRadius: '6px'
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// Format helpers
function formatCurrency(v) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(v);
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Category helpers: normalize keys and display labels
function normalizeCategoryKey(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/\u00a0/g, ' ')      // normalize non-breaking spaces
    .replace(/[_-]/g, ' ')         // treat underscores and hyphens as spaces
    .replace(/\s+/g, ' ')         // collapse spaces
    .trim();
}
function toTitleCase(s) {
  return String(s || '')
    .split(' ')
    .map(w => w ? (w[0].toUpperCase() + w.slice(1)) : '')
    .join(' ');
}
function formatCategoryLabel(v) {
  const key = normalizeCategoryKey(v);
  const map = {
    'regular': 'Regular',
    'regular corner': 'Regular Corner',
    'prime': 'Prime',
    'prime corner': 'Prime Corner',
    'commercial': 'Commercial',
    'commercial corner': 'Commercial Corner',
    'premium': 'Premium',
    'standard': 'Standard'
  };
  return map[key] || toTitleCase(key);
}

// Status helpers and updater
function normalizeStatusKey(v) {
  return String(v ?? '').toLowerCase().replace(/_/g, ' ').trim();
}
function formatStatusLabel(v) {
  const key = normalizeStatusKey(v);
  const map = {
    'open': 'Open',
    'available': 'Open',
    'reserved': 'Reserved',
    'sold': 'Sold'
  };
  return map[key] || toTitleCase(key);
}

async function handleLotStatusChange(ev) {
  const sel = ev.currentTarget;
  const lotNo = sel?.dataset?.lotNo || null;
  const phaseRaw = sel?.dataset?.phase ?? '';
  const phase = phaseRaw === '' ? null : (isNaN(Number(phaseRaw)) ? (parseInt(String(phaseRaw).match(/(\d+)/)?.[1] || '', 10) || null) : Number(phaseRaw));
  const newStatus = sel.value;
  if (!lotNo) return;
  sel.disabled = true;
  try {
    if (window.api && window.api.supabase && typeof window.api.updateLotStatus === 'function') {
      const { data: u, error } = await window.api.supabase.auth.getUser();
      if (!error && u?.user) {
        await window.api.updateLotStatus({ lotNo, phase, status: newStatus });
        showNotification('Status updated', 'info');
        // Refresh table to reflect updated last updated date
        renderInventoryTable();
      } else {
        const project = $('#projectSelect')?.value || 'MVLC';
        const lots = getInventory(project).map(l => (String(l.lotNumber || l.lot_no) === String(lotNo) ? Object.assign({}, l, { status: newStatus }) : l));
        setInventory(project, lots);
        showNotification('Status updated locally (not logged in)', 'info');
      }
    } else {
      const project = $('#projectSelect')?.value || 'MVLC';
      const lots = getInventory(project).map(l => (String(l.lotNumber || l.lot_no) === String(lotNo) ? Object.assign({}, l, { status: newStatus }) : l));
      setInventory(project, lots);
      showNotification('Status updated locally', 'info');
    }
  } catch (err) {
    console.warn('Failed to update status:', err);
    showNotification('Failed to update status', 'error');
  } finally {
    sel.disabled = false;
  }
}
// Supabase auth helper
async function hasSupabaseSession() {
  try {
    if (!window.api || !window.api.supabase) return false;
    const { data, error } = await window.api.supabase.auth.getUser();
    if (error) return false;
    return !!data?.user;
  } catch { return false; }
}

// Login handler
async function handleLogin(e) {
  e.preventDefault();
  const email = $('#email')?.value || '';
  const password = $('#password')?.value || '';
  if (!window.api) return showNotification('System not ready', 'error');
  try {
    const r = await window.api.login(email, password);
    if (r && r.success) {
      localStorage.setItem('vhbc_token', r.token);
      localStorage.setItem('vhbc_user', JSON.stringify(r.user || {}));
      window.location.href = 'dashboard.html';
    } else {
      showNotification('Invalid credentials', 'error');
    }
  } catch (err) {
    console.error(err);
    showNotification('Login failed', 'error');
  }
}

// Navigation handler (highlights)
function handleNavigation(e) {
  const link = e.currentTarget || e.target;
  const href = link.getAttribute('href');
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  link.classList.add('active');
  if (!href || href === '#') e.preventDefault();
}

// Stubs for search/filter
function handleSearch(e) { /* implement as needed */ }
function handleFilter(e) {
  if (e.target.dataset.filterType === 'project') {
    updateCategoryOptions(e.target.value);
  }
  // Re-render inventory when any filter changes
  if (document.body.getAttribute('data-page') === 'projects') {
    renderInventoryTable();
  }
}

// Update categories based on selected project
function updateCategoryOptions(projectName) {
  const sel = $('#categorySelect');
  const phase = $('#phaseContainer');
  const drop = $('#uploadMapDropdown');
  const simple = $('#uploadMapSimple');
  if (!sel) return;

  if (projectName === 'MVLC') {
    sel.innerHTML = `
      <option value="all">All Categories</option>
      <option value="Regular">Regular</option>
      <option value="Regular Corner">Regular Corner</option>
      <option value="Commercial">Commercial</option>
      <option value="Commercial Corner">Commercial Corner</option>
      <option value="Prime">Prime</option>
      <option value="Prime Corner">Prime Corner</option>
    `;
    phase?.classList.remove('d-none');
    drop?.classList.remove('d-none');
    simple?.classList.add('d-none');
  } else {
    sel.innerHTML = `
      <option value="all">All Categories</option>
      <option value="Premium">Premium</option>
      <option value="Standard">Standard</option>
    `;
    phase?.classList.add('d-none');
    drop?.classList.add('d-none');
    simple?.classList.remove('d-none');
  }
  // Also ensure inventory table reflects the new project columns
  renderInventoryTable();
}

// Render Inventory table with optional Phase column for MVLC
function renderInventoryTable() {
  const table = $('#inventoryTable');
  if (!table) return;
  const theadRow = table.querySelector('thead tr');
  const tbody = table.querySelector('tbody');
  if (!theadRow || !tbody) return;

  const project = $('#projectSelect')?.value || 'MVLC';
  const category = $('#categorySelect')?.value || 'all';
  const statusSel = $('#statusSelect')?.value || 'all';
  const phaseSel = $('#phaseSelect')?.value || 'all';
  const isMVLC = project === 'MVLC';
  // Remove local-storage based price overlays in table display
  const priceMap = null;
  const priceMapP1 = null;
  const priceMapP2 = null;
  const priceMapP3 = null;

  // Ensure Phase column exists/positioned after Lot # for MVLC; remove otherwise
  const existingPhaseTh = theadRow.querySelector('th[data-col="phase"]');
  if (isMVLC) {
    if (!existingPhaseTh) {
      const th = document.createElement('th');
      th.textContent = 'Phase';
      th.setAttribute('data-col', 'phase');
      // Insert as second column (after Lot #)
      const afterLot = theadRow.children[0] || null;
      if (afterLot && afterLot.nextSibling) {
        theadRow.insertBefore(th, afterLot.nextSibling);
      } else {
        theadRow.appendChild(th);
      }
    }
  } else {
    if (existingPhaseTh) existingPhaseTh.remove();
  }

  const finalizeRender = (lots, priceMaps = null) => {
    // Apply client-side filters while fetching all rows from Supabase
    const filtered = lots.filter(l => {
      const selCat = normalizeCategoryKey(category);
      const rowCat = normalizeCategoryKey(l.category);
      let catOk = true;
      if (selCat !== 'all') {
        catOk = rowCat === selCat || (selCat === 'commercial' && rowCat.startsWith('commercial') && rowCat !== 'commercial corner');
      }
      // Status filter: map available<->open for comparison
      let statusOk = true;
      if (statusSel !== 'all') {
        let rowStatus = normalizeStatusKey(l.status);
        if (rowStatus === 'available') rowStatus = 'open';
        const want = normalizeStatusKey(statusSel);
        statusOk = rowStatus === want;
      }
      let phaseOk = true;
      if (isMVLC && phaseSel !== 'all') {
        const lPhaseNum = typeof l.phase === 'number'
          ? l.phase
          : (String(l.phase ?? '').match(/(\d+)/) ? parseInt(String(l.phase).match(/(\d+)/)[1], 10) : null);
        const lPhaseVal = lPhaseNum ? `phase-${lPhaseNum}`.toLowerCase() : '';
        phaseOk = lPhaseVal === phaseSel.toLowerCase();
      }
      return catOk && statusOk && phaseOk;
    });

    // Sort by phase 1 -> 2 -> 3 when not filtered by a specific phase
    if (isMVLC && (phaseSel || 'all').toLowerCase() === 'all') {
      const phaseNum = (v) => {
        if (typeof v === 'number') return v;
        const m = String(v ?? '').match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 9999; // non-numeric phases go last
      };
      filtered.sort((a, b) => {
        const pa = phaseNum(a.phase);
        const pb = phaseNum(b.phase);
        if (pa !== pb) return pa - pb;
        // secondary by lot_no/lotNumber natural order
        const la = String(a.lot_no || a.lotNumber || '').toLowerCase();
        const lb = String(b.lot_no || b.lotNumber || '').toLowerCase();
        return la.localeCompare(lb, undefined, { numeric: true, sensitivity: 'base' });
      });
    }

    if (!filtered.length) {
      const colCount = theadRow.children.length;
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="text-muted">No inventory found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const l = {
        lotNumber: item.lotNumber ?? item.lot_no ?? '',
        phase: item.phase ?? item.phase_slug ?? '',
        size: item.size ?? item.size_sqm ?? '',
        pricePerSqm: item.pricePerSqm ?? item.price_per_sqm ?? 0,
        total: item.total ?? null,
        category: item.category ?? '',
        status: item.status ?? '',
        lastUpdated: item.lastUpdated ?? item.last_updated ?? null,
      };
      const catKey = normalizeCategoryKey(l.category);
      // Compute price per sqm based on category + optional server price maps
      let ppsqm = Number(l.pricePerSqm || 0);
      if (isMVLC && priceMaps) {
        const grp = typeof l.phase === 'number'
          ? (l.phase === 1 ? 'phase1' : l.phase === 2 ? 'phase2' : 'phase3')
          : (String(l.phase).toLowerCase().includes('1') ? 'phase1' : String(l.phase).toLowerCase().includes('2') ? 'phase2' : 'phase3');
        const srv = priceMaps[grp];
        if (srv) {
          const field = (catKey || '').replace(/\s+/g, '_');
          const v = srv[field];
          if (v != null && v !== '') ppsqm = Number(v);
        }
      }
      const sizeNum = Number(l.size || 0);
      const total = ppsqm && sizeNum ? (ppsqm * sizeNum) : (l.total || 0);
      const cells = [];
      cells.push(`<td>${l.lotNumber || ''}</td>`);
      if (isMVLC) cells.push(`<td>${l.phase || ''}</td>`);
      cells.push(`<td>${l.size || ''}</td>`);
      cells.push(`<td>${ppsqm ? formatCurrency(ppsqm) : ''}</td>`);
      cells.push(`<td>${total ? formatCurrency(total) : ''}</td>`);
      cells.push(`<td>${formatCategoryLabel(l.category) || ''}</td>`);
      // Status dropdown
      const statuses = ['open','reserved','sold'];
      let currentStatus = normalizeStatusKey(l.status);
      if (currentStatus === 'available') currentStatus = 'open';
      const projectIdVal = item.project_id ?? '';
      const phaseIdVal = item.phase_id ?? '';
      const lotNoVal = l.lotNumber || '';
      const options = statuses.map(s => `<option value=\"${s}\" ${currentStatus===s?'selected':''}>${formatStatusLabel(s)}</option>`).join('');
      cells.push(`<td><select class=\"form-select form-select-sm lot-status\" data-project-id=\"${projectIdVal}\" data-phase-id=\"${phaseIdVal}\" data-phase=\"${l.phase || ''}\" data-lot-no=\"${lotNoVal}\">${options}</select></td>`);
      cells.push(`<td>${l.lastUpdated ? formatDate(l.lastUpdated) : ''}</td>`);
      cells.push(`<td><button class="btn btn-sm btn-outline-primary" disabled>Details</button></td>`);
      return `<tr>${cells.join('')}</tr>`;
    }).join('');
    // Wire up status change handlers
    tbody.querySelectorAll('.lot-status').forEach(sel => sel.addEventListener('change', handleLotStatusChange));
  };

  // Fetch from Supabase only for MVLC project
  if (isMVLC && window.api && window.api.supabase && typeof window.api.getLots === 'function') {
    (async () => {
      try {
        const rows = await window.api.getLots(project);
        // Fetch server price maps by scope and compute totals per category
        let priceMaps = null;
        if (typeof window.api.getMVLCPricesByScope === 'function' && await hasSupabaseSession()) {
          try {
            const scopes = new Set();
            rows.forEach(item => {
              const p = typeof item.phase === 'number' ? item.phase : (String(item.phase ?? '').match(/(\d+)/) ? parseInt(String(item.phase).match(/(\d+)/)[1], 10) : null);
              if (p === 1) scopes.add('phase1'); else if (p === 2) scopes.add('phase2'); else if (p === 3) scopes.add('phase3');
            });
            priceMaps = {};
            for (const sc of scopes) {
              const m = await window.api.getMVLCPricesByScope(sc);
              if (m) priceMaps[sc] = m;
            }
          } catch (e) {
            priceMaps = null;
          }
        }
        finalizeRender(rows, priceMaps);
      } catch (err) {
        console.warn('Failed to fetch lots from Supabase; skipping local cache per settings.', err);
        finalizeRender([]);
      }
    })();
    return;
  }

  // No local storage fallback; show empty when no server data
  finalizeRender([]);
}

// Handle inventory CSV import
async function handleImportCsvSelected(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  const isCsv = name.endsWith('.csv') || type.includes('text/csv');
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls') || type.includes('sheet');
  if (!isCsv && !isXlsx) { showNotification('Please select a CSV or Excel file (.csv, .xlsx, .xls)', 'error'); e.target.value = ''; return; }
  const project = $('#projectSelect')?.value || 'MVLC';
  try {
    let rows = [];
    if (isXlsx) {
      if (!window.XLSX) { showNotification('Excel parser not loaded. Please check network or use CSV.', 'error'); e.target.value = ''; return; }
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    } else {
      const text = await file.text();
      rows = parseCsv(text);
    }
    if (!rows.length) throw new Error('Empty CSV');
    const norm = s => (s || '').toString().trim().toLowerCase();
    const headerRow = findHeaderRowIndex(rows);
    const headers = rows[headerRow].map(h => norm(h));
    const find = (...alts) => alts.map(a => headers.indexOf(a)).find(i => i >= 0);
    const mapIdx = {
      lot: find('lot', 'lot #', 'lot no', 'lot number', 'lot#', 'lot_num', 'lotnum', 'lot code'),
      phase: find('phase', 'phases'),
      size: find('lot area', 'size (sqm)', 'size', 'sqm'),
      status: find('status'),
      category: find('category', 'cat'),
      rsvDate: find('rsv date', 'reservation date', 'last updated', 'updated', 'date')
    };
    const lots = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => (c || '').trim() === '')) continue;
      const val = (i) => (i != null && i >= 0 ? String(row[i] || '').trim() : '');
      const num = (s) => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };

      const phaseStr = val(mapIdx.phase);
      // Previously filtered MVLC rows by specific phase letters. Removed to import all phases.

      // Extract phase number (1/2/3) from PHASE
      let phaseNum = null;
      const m = phaseStr.match(/(\d+)/);
      if (m) phaseNum = parseInt(m[1], 10);

      // Category: prefer explicit Category column; else derive from phase code letters
      let category = '';
      const fromCol = val(mapIdx.category);
      if (fromCol) {
        const low = fromCol.toLowerCase();
        if (low === 'commercial' || low === 'c') category = 'Commercial';
        else if (low === 'commercial corner' || low === 'commercial_corner' || low === 'cc') category = 'Commercial Corner';
        else if (low === 'prime' || low === 'p') category = 'Prime';
        else if (low === 'prime corner' || low === 'prime_corner' || low === 'pc') category = 'Prime Corner';
        else if (low === 'regular corner' || low === 'regular_corner' || low === 'rc') category = 'Regular Corner';
        else if (low === 'regular' || low === 'r') category = 'Regular';
        else category = fromCol; // keep as-is for display; normalized on save
      }
      if (!category) {
        const uc = phaseStr.toUpperCase();
        if (uc.includes('PC')) category = 'Prime Corner';
        else if (uc.includes('CC')) category = 'Commercial Corner';
        else if (uc.includes('RC')) category = 'Regular Corner';
        else if (uc.includes('C')) category = 'Commercial';
        else if (uc.includes('P')) category = 'Prime';
        else category = 'Regular';
      }

      // Rule: if PHASE contains letter 'K', mark as corner for the base category
      {
        const uc = phaseStr.toUpperCase();
        if (uc.includes('K')) {
          const key = (category || '').toLowerCase();
          if (!key.includes('corner')) {
            if (key === 'commercial') category = 'Commercial Corner';
            else if (key === 'prime') category = 'Prime Corner';
            else if (key === 'regular' || key === '') category = 'Regular Corner';
          }
        }
      }

      const lotItem = {
        lotNumber: val(mapIdx.lot),
        phase: phaseNum,
        size: num(val(mapIdx.size)),
        category,
        status: val(mapIdx.status),
        lastUpdated: val(mapIdx.rsvDate) || null
      };
      lots.push(lotItem);
    }
    // Merge into existing inventory: update matching (lotNumber + phase), insert new
    const existing = getInventory(project);
    const keyOf = (o) => `${String(o.lotNumber || '').trim().toLowerCase()}||${o.phase ?? ''}`;
    const idxByKey = new Map();
    existing.forEach((it, i) => idxByKey.set(keyOf(it), i));
    let updatedLocal = 0, insertedLocal = 0;
    const merged = existing.slice();
    for (const it of lots) {
      const k = keyOf(it);
      if (idxByKey.has(k)) {
        const i = idxByKey.get(k);
        merged[i] = Object.assign({}, merged[i], it);
        updatedLocal++;
      } else {
        idxByKey.set(k, merged.length);
        merged.push(it);
        insertedLocal++;
      }
    }
    setInventory(project, merged);
    showNotification(`Imported ${lots.length} rows for ${project} — updated ${updatedLocal}, added ${insertedLocal}`, 'info');

    // Save to Supabase 'lots' table if available and authenticated
    try {
      if (window.api && window.api.supabase) {
        const { data: u, error } = await window.api.supabase.auth.getUser();
        if (!error && u?.user && typeof window.api.saveLots === 'function') {
          const res = await window.api.saveLots(project, lots);
          if (res && typeof res === 'object') {
            showNotification(`Database upsert complete — updated ${res.updated || 0}, inserted ${res.inserted || 0}`, 'info');
          } else {
            showNotification('Lots saved to database', 'info');
          }
        }
      }
    } catch (dbErr) {
      const err = dbErr?.error || dbErr;
      console.warn('Saving lots to database failed:', {
        code: err?.code,
        message: err?.message,
        details: err?.details,
        hint: err?.hint
      });
      showNotification('Failed to save lots to database', 'error');
    }

    renderInventoryTable();
  } catch (err) {
    console.error('CSV import failed:', err);
    showNotification('Failed to import CSV. Check format.', 'error');
  }
  e.target.value = '';
}

// Map upload handling (image compression and PDF support)
function handleMapSelected(e) {
  const file = e.target?.files?.[0];
  if (!file) return;

  // Basic validations
  const maxSize = 10 * 1024 * 1024; // 10MB limit for storage
  if (file.size > maxSize) {
    showNotification('File too large. Please upload a file under 10MB.', 'error');
    e.target.value = '';
    return;
  }
  if (!file.type.match('image.*') && file.type !== 'application/pdf') {
    showNotification('Please upload an image or PDF file.', 'error');
    e.target.value = '';
    return;
  }

  const phase = e.target.dataset.phase || 'default';
  const project = $('#projectSelect')?.value || 'default';
  const keyBase = `vhbc_map_${project}_${phase}`;

  // Attempt to free any previous map for same slot
  try {
    localStorage.removeItem(`${keyBase}_dataurl`);
    localStorage.removeItem(`${keyBase}_name`);
    localStorage.removeItem(`${keyBase}_type`);
  } catch (err) {
    console.warn('Error clearing old data:', err);
  }

  // Prefer Supabase upload if available
  if (window.api && window.api.supabase) {
    (async () => {
      try {
        const res = await window.api.uploadMap(file, project, phase);
        const url = res?.url;
        const type = file.type;
        if (url) {
          try {
            localStorage.setItem(`${keyBase}_dataurl`, url);
            localStorage.setItem(`${keyBase}_name`, file.name || 'map');
            localStorage.setItem(`${keyBase}_type`, type);
            localStorage.setItem(`vhbc_map_${project}_latest`, phase);
          } catch {}
          showNotification(`Map uploaded for ${project} ${phase}`, 'info');
          const modalPhase = $('#mapModalPhaseSelect');
          if (modalPhase) modalPhase.value = phase;
          loadMapPreviewForPhase(phase);
        } else {
          showNotification('Upload succeeded but URL unavailable.', 'error');
        }
      } catch (err) {
        console.error('Upload failed:', err);
        showNotification('Failed to upload map. Please try again.', 'error');
      }
    })();
    e.target.value = '';
    return;
  }

  // Fallback to local preview storage if Supabase not configured
  const reader = new FileReader();
  reader.onload = () => {
    try {
      localStorage.setItem(`${keyBase}_dataurl`, reader.result);
      localStorage.setItem(`${keyBase}_name`, file.name || 'map');
      localStorage.setItem(`${keyBase}_type`, file.type);
      localStorage.setItem(`vhbc_map_${project}_latest`, phase);
    } catch {}
    showNotification(`Map uploaded for ${project} ${phase}`, 'info');
    const modalPhase = $('#mapModalPhaseSelect');
    if (modalPhase) modalPhase.value = phase;
    loadMapPreviewForPhase(phase);
  };
  reader.onerror = () => showNotification('Failed to read file. Please try again.', 'error');
  reader.readAsDataURL(file);
  e.target.value = '';
}

// Load preview for a project-phase combination
function loadMapPreviewForPhase(phase) {
  const project = $('#projectSelect')?.value || 'default';
  const keyBase = `vhbc_map_${project}_${phase}`;
  const dataUrl = localStorage.getItem(`${keyBase}_dataurl`);
  const name = localStorage.getItem(`${keyBase}_name`) || `${project} ${phase}`;
  const type = localStorage.getItem(`${keyBase}_type`) || '';

  const img = $('#mapModalImage');
  const embed = $('#mapModalEmbed');

  if (!dataUrl) {
    // Try fetch latest from DB
    if (window.api && window.api.supabase) {
      (async () => {
        const latest = await window.api.getLatestMapUrl(project, phase);
        if (latest?.url) {
          const url = latest.url;
          const t = latest.type || '';
          if (img) { img.src = url; img.style.display = t === 'application/pdf' ? 'none' : 'block'; }
          if (embed) { embed.src = url; embed.style.display = t === 'application/pdf' ? 'block' : 'none'; }
          const title = $('#mapModal .modal-title');
          if (title) title.textContent = `${project} - ${latest.name || (project + ' ' + phase)}`;
          // cache locally for faster next open
          try {
            localStorage.setItem(`${keyBase}_dataurl`, url);
            localStorage.setItem(`${keyBase}_name`, latest.name || `${project} ${phase}`);
            localStorage.setItem(`${keyBase}_type`, t);
          } catch {}
          return;
        }
        if (img) img.style.display = 'none';
        if (embed) embed.style.display = 'none';
        showNotification(`No map uploaded for ${project} ${phase}`, 'info');
      })();
      return;
    } else {
      if (img) img.style.display = 'none';
      if (embed) embed.style.display = 'none';
      showNotification(`No map uploaded for ${project} ${phase}`, 'info');
      return;
    }
  }

  if (img) { img.src = dataUrl; img.style.display = type === 'application/pdf' ? 'none' : 'block'; }
  if (embed) { embed.src = dataUrl; embed.style.display = type === 'application/pdf' ? 'block' : 'none'; }
  const title = $('#mapModal .modal-title');
  if (title) title.textContent = `${project} - ${name}`;
}

// Show modal with proper phase/project setup
function showMapModal() {
  const proj = $('#projectSelect')?.value;
  if (!proj) { showNotification('Please select a project first', 'error'); return; }
  const isMVLC = proj === 'MVLC';
  const wrap = $('#mapModalPhaseWrap');
  const modalPhase = $('#mapModalPhaseSelect');

  if (isMVLC) {
    if (wrap) wrap.style.display = 'block';
    const latest = localStorage.getItem(`vhbc_map_${proj}_latest`) || 'phase-1';
    if (modalPhase) modalPhase.value = latest;
    loadMapPreviewForPhase(modalPhase?.value || latest);
  } else {
    if (wrap) wrap.style.display = 'none';
    const d = localStorage.getItem(`vhbc_map_${proj}_default_dataurl`);
    if (!d) { showNotification(`No map uploaded yet for ${proj}`, 'info'); return; }
    loadMapPreviewForPhase('default');
  }

  const modalEl = $('#mapModal');
  if (modalEl && window.bootstrap && typeof bootstrap.Modal === 'function') {
    new bootstrap.Modal(modalEl).show();
  }
}

// Toggle mobile sidebar
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('active');
}

// Logout
function logout() {
  localStorage.removeItem('vhbc_token');
  localStorage.removeItem('vhbc_user');
  window.location.href = 'index.html';
}

// Initialize dashboard content
async function initializeDashboard() {
  if (!window.api) return;
  try {
    const data = await window.api.getDashboardData();
    if (!data) return;

    const stats = $('.dashboard-stats');
    if (stats) {
      stats.innerHTML = `
        <div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Sold</h4><h2>${data.totals.sold}</h2></div></div>
        <div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Reserved</h4><h2>${data.totals.reserved}</h2></div></div>
        <div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Available</h4><h2>${data.totals.available}</h2></div></div>
        <div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Revenue</h4><h2>${formatCurrency(data.totals.revenue)}</h2></div></div>
      `;
    }

    if (window.charts && typeof window.charts.initializeDashboardCharts === 'function') {
      await window.charts.initializeDashboardCharts();
    }

    const tb = $('#recentReservationsTable tbody');
    if (tb && data.recentReservations) {
      tb.innerHTML = data.recentReservations.map(r => `
        <tr>
          <td>${r.client}</td>
          <td>${r.project}</td>
          <td>${r.status}</td>
          <td>${formatCurrency(r.amount)}</td>
          <td>${formatDate(r.date)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Failed loading dashboard', err);
    showNotification('Failed loading dashboard', 'error');
  }
}

// Centralized event listener setup
function setupEventListeners() {
  // Login
  const loginForm = $('#loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  // Nav links
  $$('.nav-link').forEach(l => l.addEventListener('click', handleNavigation));

  // Search inputs
  $$('.search-input').forEach(i => i.addEventListener('input', debounce(handleSearch, 300)));

  // Filters
  $$('.filter-select').forEach(s => s.addEventListener('change', handleFilter));
  const phaseSelect = $('#phaseSelect');
  if (phaseSelect) phaseSelect.addEventListener('change', () => {
    if (document.body.getAttribute('data-page') === 'projects') renderInventoryTable();
  });

  // Sidebar toggle
  const sidebarToggle = document.querySelector('.sidebar-toggle');
  if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);

  // Upload map controls
  const uploadMapBtn = $('#uploadMapBtn');
  const uploadMapInput = $('#uploadMapInput');
  const uploadMapDropdown = $('#uploadMapDropdown');
  if (uploadMapBtn && uploadMapInput) {
    uploadMapBtn.addEventListener('click', () => uploadMapInput.click());
    uploadMapInput.addEventListener('change', handleMapSelected);
  }
  if (uploadMapDropdown && uploadMapInput) {
    uploadMapDropdown.querySelectorAll('.upload-map-phase').forEach(item => {
      item.addEventListener('click', ev => {
        ev.preventDefault();
        const phase = item.getAttribute('data-phase') || 'phase-1';
        uploadMapInput.dataset.phase = phase;
        uploadMapInput.click();
      });
    });
  }

  // Import CSV controls (projects page)
  const importCsvBtn = $('#importCsvBtn');
  const importCsvInput = $('#importCsvInput');
  if (importCsvBtn && importCsvInput) {
    importCsvBtn.addEventListener('click', () => importCsvInput.click());
    importCsvInput.addEventListener('change', handleImportCsvSelected);
  }

  // Clear Lots (local inventory) for selected project
  const clearLotsBtn = $('#clearLotsBtn');
  if (clearLotsBtn) {
    clearLotsBtn.addEventListener('click', () => {
      const project = $('#projectSelect')?.value || 'MVLC';
      const ok = window.confirm(`Clear all locally saved lots for ${project}?`);
      if (!ok) return;
      (async () => {
        let deleted = 0;
        try {
          if (window.api && window.api.supabase && typeof window.api.clearLots === 'function') {
            const { data: u, error } = await window.api.supabase.auth.getUser();
            if (!error && u?.user) {
              const res = await window.api.clearLots(project);
              deleted = res?.deleted || 0;
              showNotification(`Deleted ${deleted} lots from ${project}`, 'info');
            } else {
              showNotification('Not logged in. Cannot delete from server.', 'error');
            }
          }
        } catch (err) {
          console.warn('Failed to delete lots from server:', err);
          showNotification('Failed to delete lots from server', 'error');
        }
        // Also clear any local cache for consistency
        try { clearInventory(project); } catch {}
        renderInventoryTable();
      })();
    });
  }

  // Price modal controls
  const openPriceModalBtn = $('#openPriceModal');
  if (openPriceModalBtn) {
    openPriceModalBtn.addEventListener('click', () => {
      const project = $('#projectSelect')?.value || 'MVLC';
      const lots = getInventory(project);
      let categories = Array.from(new Set(lots.map(l => (l.category || '').trim()).filter(Boolean)));
      if (!categories.length) {
        categories = project === 'MVLC'
          ? ['Regular', 'Regular Corner', 'Prime', 'Prime Corner']
          : ['Premium', 'Standard'];
      }

      // MVLC: show phase group choice and adapt categories
      const phaseGroupWrap = document.getElementById('pricePhaseGroup');
      if (project === 'MVLC' && phaseGroupWrap) {
        phaseGroupWrap.style.display = '';
        // Default to Phase 2
        const r2 = document.getElementById('pricePhase2');
        if (r2) r2.checked = true;
      } else if (phaseGroupWrap) {
        phaseGroupWrap.style.display = 'none';
      }

      const currentScope = () => {
        if (project !== 'MVLC') return undefined;
        const sel = document.querySelector('input[name="pricePhase"]:checked');
        return sel ? sel.value : 'phase2';
      };

      const categoriesFor = (proj, scope) => {
        if (proj === 'MVLC') {
          if (scope === 'phase2') return ['Regular', 'Regular Corner', 'Prime', 'Prime Corner'];
          return ['Regular', 'Regular Corner', 'Commercial', 'Commercial Corner'];
        }
        return categories; // non-MVLC
      };

      const renderForm = async () => {
        const scope = currentScope();
        const localMap = getPriceMap(project, scope);
      // Prefill from server if MVLC (single table with phase column)
        if (project === 'MVLC' && window.api && window.api.supabase && typeof window.api.getMVLCPricesByScope === 'function' && await hasSupabaseSession()) {
          try {
            const srv = await window.api.getMVLCPricesByScope(scope);
            if (srv) {
              if (srv.regular != null) localMap['regular'] = srv.regular;
              if (srv.prime != null) localMap['prime'] = srv.prime;
              if (srv.regular_corner != null) localMap['regular corner'] = srv.regular_corner;
              if (srv.prime_corner != null) localMap['prime corner'] = srv.prime_corner;
              if (srv.commercial != null) localMap['commercial'] = srv.commercial;
              if (srv.commercial_corner != null) localMap['commercial corner'] = srv.commercial_corner;
            }
          } catch {}
        }
        const body = document.getElementById('priceFormBody');
        if (body) {
          const cats = categoriesFor(project, scope);
          body.innerHTML = cats.map(cat => {
            const key = (cat || '').toLowerCase();
            const val = localMap && localMap[key] != null ? localMap[key] : '';
            return `
              <div class="row g-2 align-items-center">
                <div class="col-6"><label class="form-label mb-0">${cat}</label></div>
                <div class="col-6"><input type="number" step="0.01" min="0" class="form-control price-input" data-category="${key}" placeholder="0.00" value="${val}"></div>
              </div>`;
          }).join('');
        }
      };

      (async () => { await renderForm(); })();

      // Change handler for MVLC group selection
      if (project === 'MVLC') {
        ['pricePhase1','pricePhase2','pricePhase3'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('change', renderForm);
        });
      }

      const modalEl = document.getElementById('priceModal');
      if (modalEl && window.bootstrap && typeof bootstrap.Modal === 'function') {
        new bootstrap.Modal(modalEl).show();
      }
    });
  }

  const savePricesBtn = $('#savePricesBtn');
  if (savePricesBtn) {
    savePricesBtn.addEventListener('click', () => {
      const project = $('#projectSelect')?.value || 'MVLC';
      const scope = (project === 'MVLC') ? (document.querySelector('input[name="pricePhase"]:checked')?.value || 'phase2') : undefined;
      const inputs = Array.from(document.querySelectorAll('#priceFormBody .price-input'));
      const map = getPriceMap(project, scope);
      inputs.forEach(inp => {
        const key = (inp.getAttribute('data-category') || '').toLowerCase();
        const v = inp.value;
        if (v === '' || isNaN(Number(v))) return; // skip blanks
        map[key] = Number(v);
      });
      setPriceMap(project, map, scope);

      // Apply mapped prices to stored inventory now
      const lots = getInventory(project).map(l => {
        const catKey = (l.category || '').toLowerCase();
        if (project === 'MVLC') {
          const phaseStr = String(l.phase ?? '').toLowerCase();
          const group = (typeof l.phase === 'number') ? (l.phase === 1 ? 'phase1' : l.phase === 2 ? 'phase2' : 'phase3') : (phaseStr.includes('1') ? 'phase1' : phaseStr.includes('2') ? 'phase2' : 'phase3');
          if (group !== scope) return l; // only apply to the selected scope
        }
        if (map[catKey] != null && map[catKey] !== '') return Object.assign({}, l, { pricePerSqm: Number(map[catKey]) });
        return l;
      });
      setInventory(project, lots);

      const finish = (msg = 'Category prices updated') => {
        renderInventoryTable();
        showNotification(msg, 'info');
        const modalEl = document.getElementById('priceModal');
        if (modalEl && window.bootstrap && typeof bootstrap.Modal === 'function') {
          bootstrap.Modal.getInstance(modalEl)?.hide();
        }
      };

      if (project === 'MVLC' && window.api && window.api.supabase) {
        (async () => {
          try {
            if (!(await hasSupabaseSession())) {
              finish('Not logged in. Prices saved locally.');
              return;
            }
            if (typeof window.api.setMVLCPricesByScope === 'function') {
              const payload = {
                regular: map['regular'] ?? null,
                prime: map['prime'] ?? null,
                regular_corner: map['regular corner'] ?? null,
                prime_corner: map['prime corner'] ?? null,
                commercial: map['commercial'] ?? null,
                commercial_corner: map['commercial corner'] ?? null,
              };
              await window.api.setMVLCPricesByScope(scope, payload);
            }
            finish('Category prices updated and synced');
          } catch (err) {
            console.warn('Failed syncing MVLC prices to server:', err);
            finish('Category prices updated (local only)');
          }
        })();
      } else {
        finish();
      }
    });
  }

  // View Map button (projects page)
  const viewBtn = $('#viewMap');
  if (viewBtn) viewBtn.addEventListener('click', e => { e.preventDefault(); showMapModal(); });

  // Map modal phase change
  const modalPhase = $('#mapModalPhaseSelect');
  if (modalPhase) modalPhase.addEventListener('change', () => loadMapPreviewForPhase(modalPhase.value));
}

// Bootstrapping when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();

  const page = document.body.getAttribute('data-page');
  if (page === 'dashboard') initializeDashboard();
  if (page === 'projects') {
    const p = $('#projectSelect')?.value;
    if (p) updateCategoryOptions(p);
    // Initial render for inventory
    renderInventoryTable();
  }

  const userName = $('#userName');
  const u = localStorage.getItem('vhbc_user');
  if (userName && u) {
    try { userName.textContent = JSON.parse(u).name || 'Admin'; } catch {}
  }
});
