// API module with Supabase integration + mock fallback
class API {
  constructor() {
    this.mockData = null; // resolved lazily
    this.supabase = null;
    this.user = null;

    const url = window.CONFIG?.SUPABASE_URL || '';
    const key = window.CONFIG?.SUPABASE_ANON_KEY || '';
    if (url && key && window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        this.supabase = window.supabase.createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
        });
      } catch (e) {
        console.warn('Supabase init failed. Falling back to mock.', e);
        this.supabase = null;
      }
    }
  }

  _getMock() {
    return this.mockData || window.mockData || null;
  }

  async delay(ms = 250) { return new Promise(r => setTimeout(r, ms)); }

  // Authentication
  async login(email, password) {
    if (this.supabase) {
      const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { user, session } = data || {};
      this.user = user || null;
      return {
        success: true,
        token: session?.access_token || '',
        user: { name: user?.email || 'User', email: user?.email, id: user?.id, role: 'admin' }
      };
    }
    // Mock fallback
    await this.delay();
    if (email && password) {
      return { success: true, token: 'mock-jwt-token', user: { name: 'Demo User', email, role: 'admin' } };
    }
    throw new Error('Invalid credentials');
  }

  _ensureAuth() {
    if (!this.supabase) return null;
    return this.supabase.auth.getUser();
  }

  // Helpers to resolve project/phase IDs under RLS, creating if missing for this user
  async _ensureProjectByCode(code) {
    if (!this.supabase) return null;
    // Try select first
    let { data, error } = await this.supabase
      .from('projects')
      .select('id, code')
      .eq('code', code)
      .maybeSingle();
    if (!error && data) return data.id;
    // Upsert to avoid duplicate key errors under unique(code)
    let user_id = null;
    try { user_id = (await this.supabase.auth.getUser())?.data?.user?.id || null; } catch {}
    const payload = Object.assign({ code, name: code }, user_id ? { user_id } : {});
    ({ data, error } = await this.supabase
      .from('projects')
      .upsert(payload, { onConflict: 'code' })
      .select('id')
      .maybeSingle());
    if (error) throw error;
    return data?.id || null;
  }

  async _ensurePhase(projectId, slug, name) {
    if (!this.supabase) return null;
    // Try select first
    let { data, error } = await this.supabase
      .from('phases')
      .select('id, slug')
      .eq('project_id', projectId)
      .eq('slug', slug)
      .maybeSingle();
    if (!error && data) return data.id;
    // Upsert on (project_id, slug) to avoid duplicate key violations
    let user_id = null;
    try { user_id = (await this.supabase.auth.getUser())?.data?.user?.id || null; } catch {}
    const payload = Object.assign({ project_id: projectId, slug, name: name || slug }, user_id ? { user_id } : {});
    ({ data, error } = await this.supabase
      .from('phases')
      .upsert(payload, { onConflict: 'project_id,slug' })
      .select('id')
      .maybeSingle());
    if (error) throw error;
    return data?.id || null;
  }

  // Storage: upload map file and record in uploads table
  async uploadMap(file, projectCode, phaseSlug = 'default') {
    if (!this.supabase) {
      // Fallback caller should handle local preview
      throw new Error('Supabase not configured');
    }
    const { data: userData, error: authErr } = await this.supabase.auth.getUser();
    if (authErr || !userData?.user) throw new Error('Not authenticated');
    const userId = userData.user.id;

    const projectId = await this._ensureProjectByCode(projectCode);
    const phaseId = projectCode === 'MVLC' ? await this._ensurePhase(projectId, phaseSlug, phaseSlug.replace('-', ' ').toUpperCase()) : null;

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const safeName = file.name.replace(/[^A-Za-z0-9_.-]/g, '_');
    const path = `${userId}/${projectCode}/${phaseSlug}/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;
    // For MVLC, store in dedicated 'mvlc' bucket. Others use 'maps'.
    const bucketName = (projectCode || '').toLowerCase() === 'mvlc' ? 'mvlc' : 'maps';
    const bucket = this.supabase.storage.from(bucketName);
    const { error: upErr } = await bucket.upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (upErr) throw upErr;

    // Try to get a public or signed URL
    let publicUrl = null;
    try {
      const { data: pub } = bucket.getPublicUrl(path);
      publicUrl = pub?.publicUrl || null;
    } catch {}
    if (!publicUrl) {
      const { data: signed, error: sErr } = await bucket.createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
      if (sErr) throw sErr;
      publicUrl = signed?.signedUrl || null;
    }

    // If a map already exists for this project+phase, update it; else insert a new row
    let existingId = null;
    let existingPath = null;
    try {
      let lookup = this.supabase
        .from('uploads')
        .select('id, storage_path')
        .eq('project_id', projectId)
        .eq('kind', 'map')
        .order('uploaded_at', { ascending: false })
        .limit(1);
      if (phaseId) {
        lookup = lookup.eq('phase_id', phaseId);
      } else {
        lookup = lookup.is('phase_id', null);
      }
      const { data: found } = await lookup;
      existingId = found && found[0] ? found[0].id : null;
      existingPath = found && found[0] ? found[0].storage_path : null;
    } catch {}

    if (existingId) {
      const { error: upErr2 } = await this.supabase
        .from('uploads')
        .update({
          name: file.name,
          mime_type: file.type,
          storage_path: path,
          project: projectCode,
          image_URL: publicUrl,
          current: true,
          user_id: userId || null,
          uploaded_at: new Date().toISOString()
        })
        .eq('id', existingId);
      if (upErr2) {
        // DB update failed; attempt to delete the newly uploaded file to avoid orphaned storage
        try { await bucket.remove([path]); } catch {}
        throw upErr2;
      }

      // DB update succeeded; try to delete the previously stored file to save storage
      if (existingPath && existingPath !== path) {
        try { await bucket.remove([existingPath]); } catch (delErr) { console.warn('Old file delete failed:', delErr); }
      }
      return { url: publicUrl, path, type: file.type, name: file.name, project_id: projectId, phase_id: phaseId, id: existingId };
    } else {
      const { data: rec, error: dbErr } = await this.supabase
        .from('uploads')
        .insert({
          project_id: projectId,
          phase_id: phaseId,
          kind: 'map',
          name: file.name,
          mime_type: file.type,
          storage_path: path,
          project: projectCode,
          image_URL: publicUrl,
          current: true,
          user_id: userId || null
        })
        .select('id')
        .maybeSingle();
      if (dbErr) {
        // Insert failed; attempt to delete the newly uploaded file to avoid orphaned storage
        try { await bucket.remove([path]); } catch {}
        throw dbErr;
      }
      return { url: publicUrl, path, type: file.type, name: file.name, project_id: projectId, phase_id: phaseId, id: rec?.id };
    }
  }

  // Storage: upload project development image and record in project_dev table
  // Table columns: image_link (text), user_id (uuid), project_name (text)
  async uploadProjectDevelopment(file, projectName) {
    if (!this.supabase) throw new Error('Supabase not configured');
    const { data: userData, error: authErr } = await this.supabase.auth.getUser();
    if (authErr || !userData?.user) throw new Error('Not authenticated');
    const userId = userData.user.id;

    const safeName = (file?.name || 'image').replace(/[^A-Za-z0-9_.-]/g, '_');
    const path = `${userId}/${projectName}/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;
    const bucket = this.supabase.storage.from('project_deve_updates');

    const { error: upErr } = await bucket.upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (upErr) throw upErr;

    let url = null;
    try { url = bucket.getPublicUrl(path)?.data?.publicUrl || null; } catch {}
    if (!url) {
      const { data: signed, error: sErr } = await bucket.createSignedUrl(path, 60 * 60 * 24 * 7);
      if (sErr) throw sErr;
      url = signed?.signedUrl || null;
    }

    const payload = { image_link: url, user_id: userId, project_name: projectName };
    const { data: rec, error: dbErr } = await this.supabase
      .from('project_dev')
      .insert(payload)
      .select('id')
      .maybeSingle();
    if (dbErr) {
      try { await bucket.remove([path]); } catch {}
      throw dbErr;
    }
    return { url, path, id: rec?.id };
  }

  async uploadProjectDevelopmentBatch(files = [], projectName) {
    if (!Array.isArray(files)) files = Array.from(files || []);
    const results = [];
    for (const f of files) {
      // Skip non-images
      if (!f || !f.type || !f.type.startsWith('image/')) continue;
      const r = await this.uploadProjectDevelopment(f, projectName);
      results.push(r);
    }
    return results;
  }

  // Parse bucket and path from a Supabase storage URL (public or signed)
  _parseStorageRefFromUrl(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      // Expect .../storage/v1/object/(public|sign)/<bucket>/<path...>
      const idx = parts.findIndex(p => p === 'object');
      if (idx >= 0 && parts[idx + 1] && parts[idx + 2]) {
        const bucket = parts[idx + 2];
        const path = parts.slice(idx + 3).join('/');
        return { bucket, path };
      }
    } catch {}
    return { bucket: 'project_deve_updates', path: '' };
  }

  async getProjectDevImages(projectName) {
    if (!this.supabase) return [];
    // Try with a reasonable column set; fall back to * if schema differs
    try {
      let q = this.supabase
        .from('project_dev')
        .select('id, image_link, user_id, project_name, created_at')
        .eq('project_name', projectName)
        .order('created_at', { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      try {
        const { data } = await this.supabase
          .from('project_dev')
          .select('*')
          .eq('project_name', projectName)
          .order('id', { ascending: false });
        return data || [];
      } catch {
        return [];
      }
    }
  }

  async deleteProjectDev(projectName, imageLink) {
    if (!this.supabase) throw new Error('Supabase not configured');
    // Try remove from storage first (safer to leave DB if storage fails)
    try {
      const { bucket, path } = this._parseStorageRefFromUrl(imageLink || '');
      if (bucket && path) {
        const bucketRef = this.supabase.storage.from(bucket);
        await bucketRef.remove([path]).catch(() => {});
      }
    } catch {}

    // Then remove from table
    try {
      const { error } = await this.supabase
        .from('project_dev')
        .delete()
        .eq('project_name', projectName)
        .eq('image_link', imageLink);
      if (error) throw error;
      return true;
    } catch (e) {
      throw e;
    }
  }

  async getLatestMapUrl(projectCode, phaseSlug = 'default') {
    if (!this.supabase) return null;
    const projectId = await this._ensureProjectByCode(projectCode);
    const phaseId = projectCode === 'MVLC' ? await this._ensurePhase(projectId, phaseSlug, phaseSlug) : null;
    let q = this.supabase.from('uploads').select('id, storage_path, mime_type, name, image_url').eq('project_id', projectId).eq('kind', 'map').order('uploaded_at', { ascending: false }).limit(1);
    if (phaseId) q = q.eq('phase_id', phaseId);
    const { data, error } = await q;
    if (error || !data || !data[0]) return null;
    // Prefer stored image_url if present
    let url = data[0].image_url || null;
    if (!url) {
      const path = data[0].storage_path;
      const bucketName = (projectCode || '').toLowerCase() === 'mvlc' ? 'mvlc' : 'maps';
      const bucket = this.supabase.storage.from(bucketName);
      try { url = bucket.getPublicUrl(path)?.data?.publicUrl || null; } catch {}
      if (!url) {
        const { data: signed } = await bucket.createSignedUrl(path, 60 * 60 * 24 * 7);
        url = signed?.signedUrl || null;
      }
    }
    return { url, type: data[0].mime_type, name: data[0].name };
  }

  // MVLC price management
  async getMVLCPrices() {
    if (!this.supabase) return null;
    const { data, error } = await this.supabase
      .from('mvlc_price')
      .select('id, regular, prime, regular_corner, prime_corner')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data && data[0]) ? data[0] : null;
  }

  async setMVLCPrices({ regular = null, prime = null, regular_corner = null, prime_corner = null }) {
    if (!this.supabase) throw new Error('Supabase not configured');
    // Find existing row (assumes single row usage); update if exists, else insert
    const existing = await this.getMVLCPrices().catch(() => null);
    const payload = {
      regular,
      prime,
      regular_corner,
      prime_corner,
    };
    // Include user_id if available for RLS-friendly writes
    try {
      const { data: u } = await this.supabase.auth.getUser();
      const uid = u?.user?.id || null;
      if (uid) payload.user_id = uid;
    } catch {}

    if (existing && existing.id) {
      const { data, error } = await this.supabase
        .from('mvlc_price')
        .update(payload)
        .eq('id', existing.id)
        .select('id, regular, prime, regular_corner, prime_corner')
        .maybeSingle();
      if (error) throw error;
      return data || existing;
    } else {
      const { data, error } = await this.supabase
        .from('mvlc_price')
        .insert(payload)
        .select('id, regular, prime, regular_corner, prime_corner')
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  }

  // Unified MVLC price management with phase column
  // scope: 'phase2' (2) or 'phase13' (1 & 3 combined)
  async getMVLCPricesByScope(scope = 'phase2') {
    if (!this.supabase) return null;
    // Accept 'phase1' | 'phase2' | 'phase3' (and map 'phase13' to 'phase1' for backward calls)
    const phaseVal = scope === 'phase1' ? 1 : scope === 'phase3' ? 3 : 2;
    const { data, error } = await this.supabase
      .from('mvlc_price')
      .select('id, phase, regular, prime, regular_corner, prime_corner, commercial, commercial_corner, user_id')
      .eq('phase', phaseVal)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') throw error; // ignore No rows
    return data || null;
  }

  async setMVLCPricesByScope(scope = 'phase2', {
    regular = null,
    prime = null,
    regular_corner = null,
    prime_corner = null,
    commercial = null,
    commercial_corner = null
  } = {}) {
    if (!this.supabase) throw new Error('Supabase not configured');
    const upsertForPhase = async (phaseVal) => {
      const existing = await this.supabase
        .from('mvlc_price')
        .select('id')
        .eq('phase', phaseVal)
        .maybeSingle();
      const payload = { phase: phaseVal, regular, prime, regular_corner, prime_corner, commercial, commercial_corner };
      try {
        const { data: u } = await this.supabase.auth.getUser();
        const uid = u?.user?.id || null;
        if (uid) payload.user_id = uid;
      } catch {}
      if (existing && existing.data && existing.data.id) {
        const { error } = await this.supabase
          .from('mvlc_price')
          .update(payload)
          .eq('id', existing.data.id);
        if (error) throw error;
      } else {
        const { error } = await this.supabase
          .from('mvlc_price')
          .insert(payload);
        if (error) throw error;
      }
    };
    // Accept 'phase1' | 'phase2' | 'phase3' (and map 'phase13' to both 1 and 3 for backward calls)
    if (scope === 'phase1') { await upsertForPhase(1); return { phase: 1 }; }
    if (scope === 'phase3') { await upsertForPhase(3); return { phase: 3 }; }
    if (scope === 'phase13') { await upsertForPhase(1); await upsertForPhase(3); return { phase: [1,3] }; }
    await upsertForPhase(2); return { phase: 2 };
  }

  // MVLC Phase 1 & 3 price management (separate table)
  async getMVLCPricesPhase13() {
    if (!this.supabase) return null;
    try {
      const { data, error } = await this.supabase
        .from('mvlc_price_13')
        .select('id, regular, commercial, regular_corner, commercial_corner')
        .order('id', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data && data[0]) ? data[0] : null;
    } catch (e) {
      console.warn('Fetching MVLC Phase 1&3 prices failed or table missing.', e);
      return null;
    }
  }

  async setMVLCPricesPhase13({ regular = null, commercial = null, regular_corner = null, commercial_corner = null }) {
    if (!this.supabase) throw new Error('Supabase not configured');
    const existing = await this.getMVLCPricesPhase13().catch(() => null);
    const payload = { regular, commercial, regular_corner, commercial_corner };
    try {
      const { data: u } = await this.supabase.auth.getUser();
      const uid = u?.user?.id || null;
      if (uid) payload.user_id = uid;
    } catch {}

    try {
      if (existing && existing.id) {
        const { data, error } = await this.supabase
          .from('mvlc_price_13')
          .update(payload)
          .eq('id', existing.id)
          .select('id, regular, commercial, regular_corner, commercial_corner')
          .maybeSingle();
        if (error) throw error;
        return data || existing;
      } else {
        const { data, error } = await this.supabase
          .from('mvlc_price_13')
          .insert(payload)
          .select('id, regular, commercial, regular_corner, commercial_corner')
          .maybeSingle();
        if (error) throw error;
        return data;
      }
    } catch (e) {
      console.warn('Setting MVLC Phase 1&3 prices failed or table missing.', e);
      throw e;
    }
  }

  // Dashboard Data
  async getDashboardData() {
    if (this.supabase) {
      try {
        const [{ data: totals, error: e1 }, { data: salesByMonth, error: e2 }, { data: projectBreakdown, error: e3 }, { data: recentReservations, error: e4 }] = await Promise.all([
          this.supabase.from('v_dashboard_totals').select('*').maybeSingle(),
          this.supabase.from('v_sales_by_month').select('*').order('month', { ascending: true }),
          this.supabase.from('v_project_breakdown').select('*').order('name', { ascending: true }),
          this.supabase.from('v_recent_reservations').select('*').limit(20)
        ]);
        if (e1 || e2 || e3 || e4) throw e1 || e2 || e3 || e4;
        return {
          totals: totals || { sold: 0, reserved: 0, available: 0, revenue: 0 },
          salesByMonth: salesByMonth || [],
          projectBreakdown: projectBreakdown || [],
          recentReservations: recentReservations || []
        };
      } catch (err) {
        console.warn('Supabase dashboard fetch failed. Falling back to mock.', err);
      }
    }
    await this.delay();
    const md = this._getMock();
    return md ? {
      totals: md.totals,
      salesByMonth: md.salesByMonth,
      projectBreakdown: md.projectBreakdown,
      recentReservations: md.recentReservations
    } : { totals: { sold: 0, reserved: 0, available: 0, revenue: 0 }, salesByMonth: [], projectBreakdown: [], recentReservations: [] };
  }

  // Projects
  async getProjects() {
    if (this.supabase) {
      const { data, error } = await this.supabase.from('projects').select('*').order('name');
      if (!error) return data || [];
    }
    await this.delay();
    const md = this._getMock();
    return md ? md.inventory : [];
  }

  async getProjectByName(projectName) {
    if (this.supabase) {
      const { data, error } = await this.supabase.from('projects').select('*').eq('code', projectName).maybeSingle();
      if (!error) return data || null;
    }
    await this.delay();
    const md = this._getMock();
    if (!md) return null;
    return md.inventory.find(p => p.project === projectName) || null;
  }

  // Agents (profiles)
  async getAgents() {
    if (this.supabase) {
      const { data, error } = await this.supabase.from('profiles').select('id, name, role').in('role', ['agent','manager','admin']).order('name');
      if (!error) return (data || []).map(a => ({ id: a.id, name: a.name || 'User', role: a.role }));
    }
    await this.delay();
    const md = this._getMock();
    return md ? md.agents : [];
  }

  async getAgentByName(name) {
    if (this.supabase) {
      const { data } = await this.supabase.from('profiles').select('id, name, role').ilike('name', name).maybeSingle();
      return data || null;
    }
    await this.delay();
    const md = this._getMock();
    if (!md) return null;
    return md.agents.find(a => a.name === name) || null;
  }

  // Follow-ups
  async getFollowUps() {
    if (this.supabase) {
      const { data, error } = await this.supabase.from('follow_ups').select('*').order('follow_up_date', { ascending: false });
      if (!error) return data || [];
    }
    await this.delay();
    const md = this._getMock();
    return md ? md.followUps : [];
  }

  async createFollowUp(followUpData) {
    if (this.supabase) {
      const { data: userData } = await this.supabase.auth.getUser();
      const user_id = userData?.user?.id || null;
      const payload = Object.assign({}, followUpData, user_id ? { user_id } : {});
      const { data, error } = await this.supabase.from('follow_ups').insert(payload).select('*').maybeSingle();
      if (error) throw error;
      return { success: true, followUp: data };
    }
    await this.delay();
    return { success: true, followUp: { ...followUpData, id: Date.now(), status: 'Pending' } };
  }

  // Announcements
  async getAnnouncements() {
    if (this.supabase) {
      const { data, error } = await this.supabase.from('announcements').select('*').order('created_at', { ascending: false });
      if (!error) return data || [];
    }
    await this.delay();
    const md = this._getMock();
    return md ? md.announcements : [];
  }

  async createAnnouncement(announcementData) {
    if (this.supabase) {
      const { data: userData } = await this.supabase.auth.getUser();
      const user_id = userData?.user?.id || null;
      const payload = Object.assign({}, announcementData, user_id ? { user_id } : {});
      const { data, error } = await this.supabase.from('announcements').insert(payload).select('*').maybeSingle();
      if (error) throw error;
      return { success: true, announcement: data };
    }
    await this.delay();
    return { success: true, announcement: { ...announcementData, id: Date.now(), date: new Date().toISOString().split('T')[0] } };
  }

  // Lots: fetch rows for display
  async getLots(projectCode = null) {
    if (!this.supabase) return [];
    const PAGE = 1000;
    const selectCols = 'lot_no, phase, size_sqm, price_per_sqm, total, category, status, last_updated';
    const fetchPage = async (from, to) => (
      await this.supabase
        .from('lots')
        .select(selectCols)
        .order('lot_no', { ascending: true })
        .range(from, to)
    );
    let all = [];
    let from = 0;
    while (true) {
      let { data, error } = await fetchPage(from, from + PAGE - 1);
      if (error) {
        const msg = String(error?.message || '').toLowerCase();
        const code = String(error?.code || '').toUpperCase();
        if (msg.includes('jwt expired') || code === 'PGRST301' || code === 'PGRST303' || error?.status === 401) {
          try { await this.supabase.auth.refreshSession(); } catch {}
          ({ data, error } = await fetchPage(from, from + PAGE - 1));
        }
      }
      if (error) throw error;
      const batch = data || [];
      all = all.concat(batch);
      if (batch.length < PAGE) break; // no more pages
      from += PAGE;
    }
    return all;
  }

  // Update a single lot's status by keys (lot_no + phase)
  async updateLotStatus({ lotNo, phase, status }) {
    if (!this.supabase) throw new Error('Supabase not configured');
    const norm = s => (s == null ? '' : String(s).trim().toLowerCase());
    const normalizeStatus = (val) => {
      const v = norm(val);
      if (v === 'rsv') return 'reserved';
      if (v === 'open') return 'available';
      if (v === 'available') return 'available';
      if (v === 'reserved') return 'reserved';
      if (v === 'sold') return 'sold';
      return 'available';
    };
    const newStatus = normalizeStatus(status);
    const today = new Date().toISOString().split('T')[0];
    let q = this.supabase.from('lots').update({ status: newStatus, last_updated: today }).eq('lot_no', lotNo);
    if (phase == null) q = q.is('phase', null); else q = q.eq('phase', phase);
    const { data, error } = await q.select('lot_no, phase, status, last_updated').maybeSingle();
    if (error) throw error;
    return data;
  }

  // Lots: bulk upsert parsed CSV rows
  // Table columns: lot_no, phase, size_sqm, price_per_sqm, total, category, status, last_updated, user_id
  // Expects items: { lotNumber, phase, size, category, status, lastUpdated }
  async saveLots(projectCode, items = []) {
    if (!this.supabase) throw new Error('Supabase not configured');
    if (!Array.isArray(items) || !items.length) return { inserted: 0 };
    let user_id = null;
    try { user_id = (await this.supabase.auth.getUser())?.data?.user?.id || null; } catch {}

    const toNull = v => (v === undefined || v === '' ? null : v);
    const norm = s => (s == null ? '' : String(s).trim().toLowerCase());
    const normalizeCategory = (val) => {
      const v = norm(val);
      if (v === 'commercial' || v === 'c') return 'commercial';
      if (v === 'commercial corner' || v === 'commercial_corner' || v === 'cc') return 'commercial_corner';
      if (v === 'prime' || v === 'p') return 'prime';
      if (v === 'prime corner' || v === 'prime_corner' || v === 'pc') return 'prime_corner';
      if (v === 'regular corner' || v === 'regular_corner' || v === 'rc') return 'regular_corner';
      if (v === 'regular' || v === 'r' || v === '') return 'regular';
      return v.replace(/\s+/g, '_'); // best-effort fallback
    };
    const normalizeStatus = (val) => {
      const v = norm(val);
      if (v === 'rsv') return 'reserved';
      if (v === 'open') return 'available';
      if (v === 'available') return 'available';
      if (v === 'reserved') return 'reserved';
      if (v === 'sold') return 'sold';
      return v || null; // avoid enum error on empty
    };
    // Preload MVLC category prices by phase to compute price_per_sqm and total
    let priceMaps = null;
    if ((projectCode || '').toUpperCase() === 'MVLC' && typeof this.getMVLCPricesByScope === 'function') {
      priceMaps = {};
      try {
        priceMaps.phase1 = await this.getMVLCPricesByScope('phase1');
      } catch {}
      try {
        priceMaps.phase2 = await this.getMVLCPricesByScope('phase2');
      } catch {}
      try {
        priceMaps.phase3 = await this.getMVLCPricesByScope('phase3');
      } catch {}
    }

    const rows = await Promise.all(items.map(async (it) => {
      const lot_no = toNull(it.lotNumber || null);
      const phase = typeof it.phase === 'number' ? it.phase : (parseInt(it.phase, 10) || null);
      const size_sqm = typeof it.size === 'number' ? it.size : (parseFloat(it.size) || null);
      const category = toNull(normalizeCategory(it.category || null));
      const status = toNull(normalizeStatus(it.status || null));
      let last_updated = toNull(it.lastUpdated || null);
      if (last_updated) {
        const d = new Date(last_updated);
        if (!isNaN(d.getTime())) {
          // Store as date-only string if column is date; adjust if timestamp is desired
          last_updated = d.toISOString().split('T')[0];
        } else {
          last_updated = null;
        }
      }
      // Compute price_per_sqm and total based on category and MVLC phase prices when available
      let price_per_sqm = null;
      let total = null;
      if (priceMaps && phase != null && category) {
        const scope = phase === 1 ? 'phase1' : phase === 2 ? 'phase2' : 'phase3';
        const map = priceMaps[scope] || null;
        if (map) {
          const field = String(category).toLowerCase(); // already normalized to underscores
          const pv = map[field];
          if (pv != null && pv !== '') price_per_sqm = Number(pv);
        }
      }
      if (price_per_sqm != null && size_sqm != null) {
        total = Number(price_per_sqm) * Number(size_sqm);
      }
      return {
        lot_no,
        phase,
        size_sqm,
        price_per_sqm,
        total,
        category,
        status,
        last_updated,
        user_id: user_id || null
      };
    }));

    // Upsert per row using match on (lot_no, phase)
    let inserted = 0, updated = 0;
    for (const r of rows) {
      if (!r.lot_no) continue; // skip invalid
      // Try update existing row
      const updatePayload = {
        phase: r.phase,
        size_sqm: r.size_sqm,
        price_per_sqm: r.price_per_sqm,
        total: r.total,
        category: r.category,
        status: r.status,
        last_updated: r.last_updated,
        user_id: r.user_id
      };
      let uq = this.supabase.from('lots').update(updatePayload).eq('lot_no', r.lot_no);
      if (r.phase == null) uq = uq.is('phase', null); else uq = uq.eq('phase', r.phase);
      const { data: updData, error: updErr } = await uq.select('lot_no');
      if (updErr) throw updErr;
      if (Array.isArray(updData) && updData.length > 0) {
        updated += 1;
        continue;
      }
      // Insert new row
      const { error: insErr } = await this.supabase.from('lots').insert(r);
      if (insErr) throw insErr;
      inserted += 1;
    }
    return { inserted, updated };
  }

  // Lots: delete rows for a project
  async clearLots(projectCode) {
    if (!this.supabase) throw new Error('Supabase not configured');
    // Table is MVLC-only; delete all rows
    let q = this.supabase.from('lots').delete();
    const { data, error } = await q.select('id');
    if (error) throw error;
    return { deleted: Array.isArray(data) ? data.length : 0 };
  }
}

// Export API instance
window.api = new API();
