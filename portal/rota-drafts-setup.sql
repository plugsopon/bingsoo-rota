-- ── ROTA Drafts table ─────────────────────────────────────────────────────
-- Stores AI-generated ROTA drafts (prose only) before they're finalized into
-- machine-readable JSON and published. Lets managers compare multiple drafts
-- and publish the best one without re-prompting.
CREATE TABLE IF NOT EXISTS rota_drafts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start      date NOT NULL,
  draft_number    int  NOT NULL,
  draft_text      text NOT NULL,         -- the AI prose response (markdown)
  context_snapshot jsonb NOT NULL DEFAULT '{}',  -- staff list, dates, week_label, sales, weather…
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'discarded')),
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rota_drafts_week_idx ON rota_drafts(week_start, draft_number DESC);

-- ── Per-chat scoping (added later) ─────────────────────────────────────
-- Drafts are tied to the chat that generated them, not just the week.
-- Starting a new chat → no old drafts shown. Reopening a saved chat →
-- its drafts come back.
ALTER TABLE rota_drafts ADD COLUMN IF NOT EXISTS chat_id text;
CREATE INDEX IF NOT EXISTS rota_drafts_chat_idx ON rota_drafts(chat_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE rota_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can read rota drafts"
  ON rota_drafts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s WHERE s.email = auth.jwt()->>'email' AND s.is_manager = true
  ));

CREATE POLICY "Managers can insert rota drafts"
  ON rota_drafts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM staff s WHERE s.email = auth.jwt()->>'email' AND s.is_manager = true
  ));

CREATE POLICY "Managers can update rota drafts"
  ON rota_drafts FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s WHERE s.email = auth.jwt()->>'email' AND s.is_manager = true
  ));

CREATE POLICY "Managers can delete rota drafts"
  ON rota_drafts FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s WHERE s.email = auth.jwt()->>'email' AND s.is_manager = true
  ));
