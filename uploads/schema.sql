-- VHBC Sales Portal - Database Schema (PostgreSQL/Supabase)
-- Replicates the setup used for projects like ERHD, MSCC, EBLF, and GLS

-- 1. Create Projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL, -- e.g., 'MVLC', 'ERHD', 'EBLF'
    name TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id), -- Owner/Creator
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Phases table (Optional for ERHD, used by MVLC)
CREATE TABLE IF NOT EXISTS phases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    slug TEXT NOT NULL, -- e.g., 'phase-1', 'phase-2'
    name TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id),
    UNIQUE(project_id, slug)
);

-- 3. Create Uploads table (Map Management)
-- Mirrors functionality of ERHD: kind='map', phase_id=NULL
CREATE TABLE IF NOT EXISTS uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    phase_id UUID REFERENCES phases(id) ON DELETE SET NULL, -- NULL for projects like ERHD
    kind TEXT NOT NULL DEFAULT 'map', -- Supports 'map', 'flyer', 'development'
    name TEXT NOT NULL, -- Original filename
    mime_type TEXT,
    storage_path TEXT NOT NULL, -- Path in Supabase Storage
    project TEXT, -- Redundant project code for query convenience
    image_URL TEXT, -- Public or signed URL
    current BOOLEAN DEFAULT true,
    user_id UUID REFERENCES auth.users(id),
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create Lots table (Inventory)
CREATE TABLE IF NOT EXISTS lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    lot_no TEXT NOT NULL,
    phase INTEGER, -- Phase number (1, 2, 3)
    size_sqm NUMERIC,
    price_per_sqm NUMERIC,
    total NUMERIC,
    category TEXT, -- e.g., 'Premium', 'Standard', 'Regular'
    status TEXT DEFAULT 'available', -- 'available', 'reserved', 'sold'
    last_updated DATE DEFAULT CURRENT_DATE,
    user_id UUID REFERENCES auth.users(id),
    UNIQUE(project_id, lot_no, phase)
);

-- 5. Create MVLC Price table (Special handling for MVLC)
CREATE TABLE IF NOT EXISTS mvlc_price (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phase INTEGER NOT NULL, -- 1, 2, or 3
    regular NUMERIC,
    prime NUMERIC,
    regular_corner NUMERIC,
    prime_corner NUMERIC,
    commercial NUMERIC,
    commercial_corner NUMERIC,
    user_id UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(phase)
);

-- 6. Essential Views for Dashboard (Used by api.js)

-- Dashboard Totals
CREATE OR REPLACE VIEW v_dashboard_totals AS
SELECT 
    COUNT(*) FILTER (WHERE status = 'sold') as sold,
    COUNT(*) FILTER (WHERE status = 'reserved') as reserved,
    COUNT(*) FILTER (WHERE status = 'available' OR status = 'open') as available,
    SUM(total) FILTER (WHERE status = 'sold') as revenue
FROM lots;

-- Sales by Project
CREATE OR REPLACE VIEW v_project_breakdown AS
SELECT 
    p.code as name,
    COUNT(*) FILTER (WHERE l.status = 'sold') as sold,
    COUNT(*) FILTER (WHERE l.status = 'reserved') as reserved,
    COUNT(*) FILTER (WHERE l.status = 'available' OR l.status = 'open') as available
FROM projects p
LEFT JOIN JOIN lots l ON p.id = l.project_id
GROUP BY p.code;

-- Recent Reservations
CREATE OR REPLACE VIEW v_recent_reservations AS
SELECT 
    l.lot_no as client, -- Placeholder: in current app lot_no/client info might be shared or stored in follow-ups
    p.code as project,
    l.status,
    l.total as amount,
    l.last_updated as date
FROM lots l
JOIN projects p ON l.project_id = p.id
WHERE l.status IN ('reserved', 'sold')
ORDER BY l.last_updated DESC;

-- 7. Create EBLF Price table (Special handling for EBLF)
CREATE TABLE IF NOT EXISTS eblf_price (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phase_scope TEXT NOT NULL, -- e.g., 'phase_main', 'phase_pdr'
    regular NUMERIC,
    prime NUMERIC,
    regular_corner NUMERIC,
    prime_corner NUMERIC,
    user_id UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(phase_scope)
);

-- 8. Create GLS Price table (Replicates EBLF functionality)
CREATE TABLE IF NOT EXISTS gls_price (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phase_scope TEXT NOT NULL, -- e.g., 'phase_main', 'phase_pdr'
    regular NUMERIC,
    prime NUMERIC,
    regular_corner NUMERIC,
    prime_corner NUMERIC,
    user_id UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(phase_scope)
);
