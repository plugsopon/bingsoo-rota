-- ============================================================
-- Bingsoo ROTA Overrides — Supabase SQL Setup
-- Run once in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- 1. Create rota_overrides table
CREATE TABLE IF NOT EXISTS public.rota_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date        date NOT NULL,
  start_time  text NOT NULL,   -- e.g. "09:00"
  end_time    text NOT NULL,   -- e.g. "17:00"
  note        text DEFAULT '',
  created_by  uuid REFERENCES public.staff(id),
  created_at  timestamptz DEFAULT now(),
  UNIQUE(staff_id, date)
);

-- RLS: only the manager can read/write
ALTER TABLE public.rota_overrides ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "Manager can manage overrides" ON public.rota_overrides;
DROP POLICY IF EXISTS "Staff can read own overrides" ON public.rota_overrides;

-- Managers can do everything
CREATE POLICY "Manager can manage overrides"
  ON public.rota_overrides
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true)
  );

-- Staff can read their own overrides (for schedule.html)
CREATE POLICY "Staff can read own overrides"
  ON public.rota_overrides
  FOR SELECT
  USING (staff_id = auth.uid());

-- 2. Get overrides for a date range (manager sees all, staff sees own)
CREATE OR REPLACE FUNCTION get_rota_overrides(p_week_start date, p_week_end date)
RETURNS TABLE(
  id         uuid,
  staff_id   uuid,
  staff_name text,
  date       date,
  start_time text,
  end_time   text,
  note       text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only managers can call this for all staff
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT o.id, o.staff_id, s.name, o.date, o.start_time, o.end_time, o.note
    FROM public.rota_overrides o
    JOIN public.staff s ON s.id = o.staff_id
    WHERE o.date >= p_week_start AND o.date <= p_week_end
    ORDER BY s.role, s.name, o.date;
END;
$$;

-- 3. Upsert a single override (manager only)
CREATE OR REPLACE FUNCTION upsert_rota_override(
  p_staff_id   uuid,
  p_date       date,
  p_start_time text,
  p_end_time   text,
  p_note       text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.rota_overrides (staff_id, date, start_time, end_time, note, created_by)
  VALUES (p_staff_id, p_date, p_start_time, p_end_time, p_note, auth.uid())
  ON CONFLICT (staff_id, date) DO UPDATE SET
    start_time = EXCLUDED.start_time,
    end_time   = EXCLUDED.end_time,
    note       = EXCLUDED.note,
    created_by = EXCLUDED.created_by,
    created_at = now();
END;
$$;

-- 4. Delete an override (manager only)
CREATE OR REPLACE FUNCTION delete_rota_override(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.rota_overrides WHERE id = p_id;
END;
$$;
