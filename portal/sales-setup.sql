-- ── Sales table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date          date NOT NULL,
  eat_in_gross  numeric(10,2) DEFAULT 0,
  eat_in_vat    numeric(10,2) DEFAULT 0,
  eat_in_net    numeric(10,2) DEFAULT 0,
  ubereats      numeric(10,2) DEFAULT 0,
  deliveroo     numeric(10,2) DEFAULT 0,
  delivery_comm numeric(10,2) DEFAULT 0,
  delivery_total numeric(10,2) DEFAULT 0,
  daily_total   numeric(10,2) DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT sales_date_unique UNIQUE (date)
);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Authenticated can read sales" ON sales
  FOR SELECT TO authenticated USING (true);

-- Only managers can insert/update/delete (using auth.jwt() — no auth.users join needed)
CREATE POLICY "Managers can insert sales" ON sales
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM staff s WHERE s.email = auth.jwt()->>'email' AND s.is_manager = true
  ));

CREATE POLICY "Managers can update sales" ON sales
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s WHERE s.email = auth.jwt()->>'email' AND s.is_manager = true
  ));

CREATE POLICY "Managers can delete sales" ON sales
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s WHERE s.email = auth.jwt()->>'email' AND s.is_manager = true
  ));
