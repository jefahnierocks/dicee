-- Profiles column privileges (D-01 / SECURITY-01).
--
-- The row-owner UPDATE policy on public.profiles has no column restriction, and
-- Supabase's default table grants give anon and authenticated UPDATE on every
-- column. Any signed-in user (including an anonymous sign-in) could therefore
-- set their own profiles.role, which has_admin_permission() trusts.
--
-- This migration:
-- 1. Replaces table-level INSERT/UPDATE for anon and authenticated with
--    column-level grants limited to user-editable profile fields.
-- 2. Adds an owner-only INSERT policy so an authenticated client can
--    self-heal a missing profile with INSERT ... ON CONFLICT DO NOTHING.
-- 3. Makes profiles.is_anonymous server-derived from auth.users on insert and
--    on identity linking, replacing the client-side write.
--
-- service_role grants are intentionally unchanged. role, rating, badge and
-- is_anonymous changes go through SECURITY DEFINER functions or service_role.

-- ---------------------------------------------------------------------------
-- 1. Column-level write privileges
-- ---------------------------------------------------------------------------

-- Revoking the table privilege also revokes any column privileges of the same
-- kind, so the grants below are the complete allowlist.
REVOKE INSERT, UPDATE ON TABLE public.profiles FROM anon, authenticated;

GRANT UPDATE (
  username,
  display_name,
  bio,
  avatar_seed,
  avatar_style,
  is_public,
  last_seen_at,
  preferences
) ON TABLE public.profiles TO authenticated;

GRANT INSERT (
  id,
  username,
  display_name,
  bio,
  avatar_seed,
  avatar_style,
  is_public,
  last_seen_at,
  preferences
) ON TABLE public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Owner-only INSERT policy
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Server-derived is_anonymous
-- ---------------------------------------------------------------------------

-- Every profile insert takes is_anonymous from auth.users, whoever inserts it.
CREATE OR REPLACE FUNCTION public.profiles_set_is_anonymous()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.is_anonymous := COALESCE(
    (SELECT u.is_anonymous FROM auth.users AS u WHERE u.id = NEW.id),
    false
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_set_is_anonymous() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_set_is_anonymous ON public.profiles;
CREATE TRIGGER profiles_set_is_anonymous
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_set_is_anonymous();

-- Linking an identity to an anonymous user flips auth.users.is_anonymous.
CREATE OR REPLACE FUNCTION public.sync_profile_is_anonymous()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles
  SET is_anonymous = COALESCE(NEW.is_anonymous, false)
  WHERE id = NEW.id
    AND is_anonymous IS DISTINCT FROM COALESCE(NEW.is_anonymous, false);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_is_anonymous() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_is_anonymous_changed
  AFTER UPDATE OF is_anonymous ON auth.users
  FOR EACH ROW
  WHEN (OLD.is_anonymous IS DISTINCT FROM NEW.is_anonymous)
  EXECUTE FUNCTION public.sync_profile_is_anonymous();

-- Reconcile any client-written drift from before this migration.
UPDATE public.profiles AS p
SET is_anonymous = COALESCE(u.is_anonymous, false)
FROM auth.users AS u
WHERE u.id = p.id
  AND p.is_anonymous IS DISTINCT FROM COALESCE(u.is_anonymous, false);
