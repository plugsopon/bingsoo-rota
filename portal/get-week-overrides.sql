-- ============================================================
-- get_week_overrides — accessible to any authenticated user
-- Run in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

CREATE OR REPLACE FUNCTION get_week_overrides(p_week_start date, p_week_end date)
RETURNS TABLE(
  staff_name text,
  date       date,
  start_time text,
  end_time   text,
  break_hrs  numeric,
  note       text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN QUERY
    SELECT st.name::text, ro.date, ro.start_time, ro.end_time,
           0::numeric,  -- rota_overrides has no break_hrs column
           ro.note
    FROM public.rota_overrides ro
    JOIN public.staff st ON st.id = ro.staff_id
    WHERE ro.date >= p_week_start AND ro.date <= p_week_end
    ORDER BY ro.date, st.name;
END;
$$;
