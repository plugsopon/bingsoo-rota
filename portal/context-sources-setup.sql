-- ── Context Sources table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS context_sources (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text NOT NULL,
  type       text NOT NULL CHECK (type IN ('sheet', 'note')),
  config     jsonb NOT NULL DEFAULT '{}',
  is_enabled boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE context_sources ENABLE ROW LEVEL SECURITY;

-- Helper: is current user a manager?
-- (reused pattern from other tables)

CREATE POLICY "Managers can read context sources"
  ON context_sources FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff s
      JOIN auth.users u ON u.id = auth.uid()
      WHERE u.email = s.email AND s.is_manager = true
    )
  );

CREATE POLICY "Managers can insert context sources"
  ON context_sources FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff s
      JOIN auth.users u ON u.id = auth.uid()
      WHERE u.email = s.email AND s.is_manager = true
    )
  );

CREATE POLICY "Managers can update context sources"
  ON context_sources FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff s
      JOIN auth.users u ON u.id = auth.uid()
      WHERE u.email = s.email AND s.is_manager = true
    )
  );

CREATE POLICY "Managers can delete context sources"
  ON context_sources FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff s
      JOIN auth.users u ON u.id = auth.uid()
      WHERE u.email = s.email AND s.is_manager = true
    )
  );
