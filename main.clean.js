// Clean main file used temporarily while main.js is being repaired

if (!window.api) window.api = typeof API !== 'undefined' ? new API() : null;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function setupEventListeners() {
  const loginForm = $('#loginForm'); if (loginForm) loginForm.addEventListener('submit', handleLogin);
  $$('.nav-link').forEach(l=>l.addEventListener('click', handleNavigation));
  $$('.search-input').forEach(i=>i.addEventListener('input', debounce(handleSearch,300)));
  $$('.filter-select').forEach(s=>s.addEventListener('change', handleFilter));
  const up = $('#uploadMapInput'); const upBtn = $('#uploadMapBtn'); if (up && upBtn){ upBtn.addEventListener('click', ()=>up.click()); up.addEventListener('change', handleMapSelected); }
  const dropdown = $('#uploadMapDropdown'); if (dropdown && up) dropdown.querySelectorAll('.upload-map-phase').forEach(item=>item.addEventListener('click', ev=>{ ev.preventDefault(); up.dataset.phase = item.getAttribute('data-phase')||'phase-1'; up.click(); }));
  const viewBtn = $('#viewMap'); if(viewBtn) viewBtn.addEventListener('click', e=>{ e.preventDefault(); showMapModal(); });
  const modalPhase = $('#mapModalPhaseSelect'); if(modalPhase) modalPhase.addEventListener('change', ()=>loadMapPreviewForPhase(modalPhase.value));
}

async function handleLogin(e){ e.preventDefault(); const email = $('#email')?.value||''; const password = $('#password')?.value||''; if(!window.api) return showNotification('System not ready','error'); try{ const r = await window.api.login(email,password); if(r && r.success){ localStorage.setItem('vhbc_token', r.token); localStorage.setItem('vhbc_user', JSON.stringify(r.user||{})); window.location.href='dashboard.html'; } else showNotification('Invalid credentials','error'); }catch(err){ console.error(err); showNotification('Login failed','error'); }}
function handleNavigation(e){ const link = e.currentTarget||e.target; const href = link.getAttribute('href'); $$('.nav-link').forEach(l=>l.classList.remove('active')); link.classList.add('active'); if(!href||href==='#') e.preventDefault(); }
function debounce(fn,wait){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),wait); }; }
function handleSearch(e){}
function handleFilter(e){ if(e.target.dataset.filterType==='project') updateCategoryOptions(e.target.value); }
function updateCategoryOptions(projectName){ const sel = $('#categorySelect'); const phase = $('#phaseContainer'); const drop = $('#uploadMapDropdown'); const simple = $('#uploadMapSimple'); if(!sel) return; if(projectName==='MVLC'){ sel.innerHTML=`<option value="all">All Categories</option><option value="Regular">Regular</option><option value="Regular Corner">Regular Corner</option><option value="Prime">Prime</option><option value="Prime Corner">Prime Corner</option>`; phase?.classList.remove('d-none'); drop?.classList.remove('d-none'); simple?.classList.add('d-none'); } else { sel.innerHTML=`<option value="all">All Categories</option><option value="Premium">Premium</option><option value="Standard">Standard</option>`; phase?.classList.add('d-none'); drop?.classList.add('d-none'); simple?.classList.remove('d-none'); } }
function showNotification(m,t='info'){ const el=document.createElement('div'); el.textContent=m; el.className=`vhbc-${t}`; Object.assign(el.style,{position:'fixed',right:'20px',top:'20px',padding:'8px 12px',color:'#fff',background:t==='error'?'#e74c3c':'#2ecc71',zIndex:9999,borderRadius:'6px'}); document.body.appendChild(el); setTimeout(()=>el.remove(),3000); }
async function initializeDashboard(){ if(!window.api) return; try{ const data = await window.api.getDashboardData(); if(!data) return; const stats=$('.dashboard-stats'); if(stats) stats.innerHTML=`<div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Sold</h4><h2>${data.totals.sold}</h2></div></div><div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Reserved</h4><h2>${data.totals.reserved}</h2></div></div><div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Available</h4><h2>${data.totals.available}</h2></div></div><div class="col-md-3 col-sm-6 mb-4"><div class="dashboard-card"><h4>Total Revenue</h4><h2>${formatCurrency(data.totals.revenue)}</h2></div></div>`; if(window.charts && typeof window.charts.initializeDashboardCharts==='function') await window.charts.initializeDashboardCharts(); const tb = $('#recentReservationsTable tbody'); if(tb && data.recentReservations) tb.innerHTML = data.recentReservations.map(r=>`<tr><td>${r.client}</td><td>${r.project}</td><td>${r.status}</td><td>${formatCurrency(r.amount)}</td><td>${formatDate(r.date)}</td></tr>`).join(''); }catch(err){ console.error(err); showNotification('Failed loading dashboard','error'); } }
function formatCurrency(v){ return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(v); }
function formatDate(d){ return new Date(d).toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}); }
function handleMapSelected(e){ 
  const file = e.target.files?.[0]; 
  if(!file) return;

  // Check file size - limit to 2MB
  const maxSize = 2 * 1024 * 1024; // 2MB in bytes
  if (file.size > maxSize) {
    showNotification('File too large. Please upload an image under 2MB.', 'error');
    e.target.value = '';
    return;
  }

  // Check file type
  if (!file.type.match('image.*') && file.type !== 'application/pdf') {
    showNotification('Please upload an image or PDF file.', 'error');
    e.target.value = '';
    return;
  }

  const phase = e.target.dataset.phase || 'default';
  const project = $('#projectSelect')?.value || 'default';

  // Clear some space in localStorage if needed
  try {
    // Try to remove old data for this project/phase
    const key = `vhbc_map_${project}_${phase}`;
    localStorage.removeItem(`${key}_dataurl`);
    localStorage.removeItem(`${key}_name`);
    localStorage.removeItem(`${key}_type`);
  } catch(err) {
    console.warn('Error clearing old data:', err);
  }

  const reader = new FileReader(); 
  reader.onload = () => { 
    try {
      // First check if we have space by trying to store a small test item
      const testKey = `test_${Date.now()}`;
      try {
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
      } catch(e) {
        showNotification('localStorage is full. Please clear some space by removing old maps.', 'error');
        return;
      }

      // Compress image if it's not a PDF
      if (file.type.match('image.*')) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          // Scale down if too large
          if (width > 1200) {
            height = Math.round(height * 1200 / width);
            width = 1200;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Get compressed data URL
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          
          // Now save the compressed version
          const key = `vhbc_map_${project}_${phase}`;
          localStorage.setItem(`${key}_dataurl`, compressedDataUrl);
          localStorage.setItem(`${key}_name`, file.name || 'map');
          localStorage.setItem(`${key}_type`, 'image/jpeg');
          localStorage.setItem(`vhbc_map_${project}_latest`, phase);
          
          showNotification(`Map uploaded for ${project} ${phase}`, 'info');
          const modalPhase = $('#mapModalPhaseSelect');
          if(modalPhase) modalPhase.value = phase;
          loadMapPreviewForPhase(phase);
        };
        img.src = reader.result;
      } else {
        // Handle PDF directly
        const key = `vhbc_map_${project}_${phase}`;
        localStorage.setItem(`${key}_dataurl`, reader.result);
        localStorage.setItem(`${key}_name`, file.name || 'map');
        localStorage.setItem(`${key}_type`, file.type);
        localStorage.setItem(`vhbc_map_${project}_latest`, phase);
        
        showNotification(`Map uploaded for ${project} ${phase}`, 'info');
        const modalPhase = $('#mapModalPhaseSelect');
        if(modalPhase) modalPhase.value = phase;
        loadMapPreviewForPhase(phase);
      }
    } catch(err) { 
      console.error('Storage error:', err);
      showNotification('Unable to save map. Please try a smaller file or clear some space.', 'error');
    }
  };

  reader.onerror = err => { 
    console.error('File read error:', err);
    showNotification('Failed to read file. Please try again.', 'error');
  };

  reader.readAsDataURL(file);
  e.target.value = '';
}
function loadMapPreviewForPhase(phase){ 
  const project = $('#projectSelect')?.value || 'default';
  const key=`vhbc_map_${project}_${phase}`;
  const dataUrl=localStorage.getItem(`${key}_dataurl`);
  const name=localStorage.getItem(`${key}_name`)||`${project} ${phase}`;
  const type=localStorage.getItem(`${key}_type`)||'';
  const img=$('#mapModalImage');
  const embed=$('#mapModalEmbed');
  if(!dataUrl){ 
    if(img) img.style.display='none';
    if(embed) embed.style.display='none';
    showNotification(`No map uploaded for ${project} ${phase}`,'info');
    return;
  }
  if(img){ 
    img.src=dataUrl;
    img.style.display = type==='application/pdf'?'none':'block';
  }
  if(embed){
    embed.src=dataUrl;
    embed.style.display = type==='application/pdf'?'block':'none';
  }
  const t=$('#mapModal .modal-title');
  if(t) t.textContent = `${project} - ${name}`;
}
function showMapModal(){ 
  const proj = $('#projectSelect')?.value;
  if (!proj) {
    showNotification('Please select a project first', 'error');
    return;
  }
  const isMVLC = proj==='MVLC';
  const wrap = $('#mapModalPhaseWrap');
  const modalPhase = $('#mapModalPhaseSelect');
  if(isMVLC){ 
    wrap&&(wrap.style.display='block');
    const latest = localStorage.getItem(`vhbc_map_${proj}_latest`)||'phase-1';
    if(modalPhase) modalPhase.value=latest;
    loadMapPreviewForPhase(modalPhase?.value||latest);
  } else {
    wrap&&(wrap.style.display='none');
    const data=localStorage.getItem(`vhbc_map_${proj}_default_dataurl`);
    if(!data){
      showNotification(`No map uploaded yet for ${proj}`, 'info');
      return;
    }
    loadMapPreviewForPhase('default');
  }
  const m=$('#mapModal');
  if(m) new bootstrap.Modal(m).show();
}

document.addEventListener('DOMContentLoaded', ()=>{ setupEventListeners(); const page = document.body.getAttribute('data-page'); if(page==='dashboard') initializeDashboard(); if(page==='projects'){ const p=$('#projectSelect')?.value; if(p) updateCategoryOptions(p);} const userName=$('#userName'); const u=localStorage.getItem('vhbc_user'); if(userName && u){ try{ userName.textContent = JSON.parse(u).name || 'Admin'; }catch{} } });
