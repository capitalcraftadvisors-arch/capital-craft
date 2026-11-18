-- 0124 — Is this PAN / GSTIN already another EPC's? (18/11/2026)
--
-- A new mobile signs up and starts onboarding; when its business PAN card or
-- GST registration is read, the portal asks this. If another EPC already has
-- that PAN or GSTIN, onboarding stops with "already registered — add the user
-- from your partner portal" (one company = one EPC account + its staff logins,
-- 0119), instead of a second account for the same company (e.g. A V SOLAR twice).
--
-- An EPC can't read other epc_business rows (RLS), so this is security definer
-- and answers ONLY yes / no for each — never another EPC's details. The
-- caller's own row is never counted; CC team rows (business_type admin) neither.
--
-- rollback: drop function if exists epc_pan_gst_taken(text, text);

create or replace function epc_pan_gst_taken(p_pan text, p_gstin text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select nullif(auth.jwt() ->> 'business_id', '')::uuid as id),
       q  as (select nullif(upper(btrim(coalesce(p_pan, ''))), '') as pan,
                     nullif(upper(btrim(coalesce(p_gstin, ''))), '') as gstin)
  select jsonb_build_object(
    'pan', exists (
      select 1 from epc_business b, me, q
      where q.pan is not null and upper(btrim(b.pan_number)) = q.pan
        and b.id is distinct from me.id and b.business_type is distinct from 'admin'),
    'gstin', exists (
      select 1 from epc_business b, me, q
      where q.gstin is not null and upper(btrim(b.gstin_number)) = q.gstin
        and b.id is distinct from me.id and b.business_type is distinct from 'admin')
  );
$$;

revoke all on function epc_pan_gst_taken(text, text) from public;
grant execute on function epc_pan_gst_taken(text, text) to authenticated;
