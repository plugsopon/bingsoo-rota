-- ============================================================
-- Bingsoo Staff Management — Supabase SQL Setup
-- Run this once in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- 1. Add new columns to staff table
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS email      text,
  ADD COLUMN IF NOT EXISTS visa_type  text DEFAULT 'British/Settled';

-- 2. Get all staff details (manager-only)
CREATE OR REPLACE FUNCTION get_all_staff_for_manage()
RETURNS TABLE(
  id             uuid,
  name           text,
  email          text,
  role           text,
  visa_type      text,
  contract_hours integer,
  is_manager     boolean
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT s.id, s.name, s.email, s.role,
           COALESCE(s.visa_type, 'British/Settled'),
           s.contract_hours, s.is_manager
    FROM public.staff s
    ORDER BY s.role, s.name;
END;
$$;

-- 3. Add or update a staff member (manager-only)
CREATE OR REPLACE FUNCTION upsert_staff_member(
  p_id             uuid,
  p_name           text,
  p_email          text,
  p_role           text,
  p_visa_type      text,
  p_contract_hours integer,
  p_is_manager     boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.staff (id, name, email, role, visa_type, contract_hours, is_manager)
  VALUES (p_id, p_name, p_email, p_role, p_visa_type, p_contract_hours, p_is_manager)
  ON CONFLICT (id) DO UPDATE SET
    name           = EXCLUDED.name,
    email          = COALESCE(EXCLUDED.email, public.staff.email),  -- keep existing if null passed
    role           = EXCLUDED.role,
    visa_type      = EXCLUDED.visa_type,
    contract_hours = EXCLUDED.contract_hours,
    is_manager     = EXCLUDED.is_manager;
END;
$$;

-- 4. Remove a staff member (manager-only)
-- Cleans up dependent rows in case FK constraints aren't ON DELETE CASCADE
-- (the `availability` table was created manually without CASCADE).
CREATE OR REPLACE FUNCTION remove_staff_member(p_staff_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.is_manager = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Pre-clean dependents so any non-cascading FK doesn't block the delete.
  DELETE FROM public.availability    WHERE staff_id = p_staff_id;
  DELETE FROM public.rota_shifts     WHERE staff_id = p_staff_id;
  DELETE FROM public.rota_overrides  WHERE staff_id = p_staff_id;

  DELETE FROM public.staff WHERE id = p_staff_id;
END;
$$;

-- 5. (One-time fix) Make the availability FK cascade so future deletes are clean.
-- Safe to re-run: drops constraint if exists then re-adds with CASCADE.
ALTER TABLE public.availability
  DROP CONSTRAINT IF EXISTS availability_staff_id_fkey;

ALTER TABLE public.availability
  ADD CONSTRAINT availability_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
