-- ============================================================
-- Bingsoo ROTA Generated Shifts — Supabase SQL Setup
-- Run once in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- 1. Create rota_shifts table (stores Python-generated shift times)
CREATE TABLE IF NOT EXISTS public.rota_shifts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date         date NOT NULL,
  start_time   text NOT NULL,
  end_time     text NOT NULL,
  break_hrs    numeric DEFAULT 0,
  work_hrs     numeric DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(staff_id, date)
);

-- RLS
ALTER TABLE public.rota_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert generated shifts" ON public.rota_shifts;
DROP POLICY IF EXISTS "Staff can read own shifts" ON public.rota_shifts;
DROP POLICY IF EXISTS "Manager can read all shifts" ON public.rota_shifts;

-- Python script (anon key) can insert/update shifts
CREATE POLICY "Anyone can insert generated shifts"
  ON public.rota_shifts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update generated shifts"
  ON public.rota_shifts FOR UPDATE
  USING (true) WITH CHECK (true);

-- Staff can read their own shifts
CREATE POLICY "Staff can read own shifts"
  ON public.rota_shifts FOR SELECT
  USING (staff_id = auth.uid());

-- Managers can read all shifts
CREATE POLICY "Manager can read all shifts"
  ON public.rota_shifts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true)
  );

-- 2. Get generated shifts for a week (manager only, returns all staff)
CREATE OR REPLACE FUNCTION get_rota_shifts(p_week_start date, p_week_end date)
RETURNS TABLE(
  id         uuid,
  staff_id   uuid,
  staff_name text,
  date       date,
  start_time text,
  end_time   text,
  break_hrs  numeric,
  work_hrs   numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT rs.id, rs.staff_id, st.name, rs.date,
           rs.start_time, rs.end_time, rs.break_hrs, rs.work_hrs
    FROM public.rota_shifts rs
    JOIN public.staff st ON st.id = rs.staff_id
    WHERE rs.date >= p_week_start AND rs.date <= p_week_end
    ORDER BY st.role, st.name, rs.date;
END;
$$;
