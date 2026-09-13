-- Public-release security hardening.
-- Applies least privilege to SECURITY DEFINER functions and makes profile-backed
-- leaderboard visibility explicitly opt-in.

ALTER TABLE public.profiles ALTER COLUMN is_public SET DEFAULT false;
UPDATE public.profiles SET is_public = false WHERE is_public = true;

-- Remove legacy duplicate identity and raw console fields from private reports.
-- The auth user id remains the sole ownership key and RLS keeps reports private.
ALTER TABLE public.bug_reports
  DROP COLUMN IF EXISTS user_email,
  DROP COLUMN IF EXISTS user_display_name,
  DROP COLUMN IF EXISTS user_context,
  DROP COLUMN IF EXISTS console_capture;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, is_anonymous, is_public)
  VALUES (NEW.id, COALESCE(NEW.is_anonymous, false), false);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- This removes only Supabase's per-schema default grants to anon and
-- authenticated. PostgreSQL grants EXECUTE on new functions to PUBLIC globally,
-- and a per-schema ALTER DEFAULT PRIVILEGES cannot revoke a global default, so
-- new functions in public stay executable by anon and authenticated through
-- PUBLIC. Every new function must REVOKE explicitly, as the functions below do.
-- A global default-privilege change is deferred to the explicit-grants work.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_admin_permission(user_id uuid, perm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' AND user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.role = p.role
    WHERE p.id = user_id
      AND (ap.permission = perm OR ap.permission = '*')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_permissions(user_id uuid)
RETURNS TABLE(permission text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' AND user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  RETURN QUERY
  SELECT ap.permission
  FROM public.profiles AS p
  JOIN public.admin_permissions AS ap ON ap.role = p.role
  WHERE p.id = user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid)
RETURNS public.admin_role
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  result public.admin_role;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' AND user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT role INTO result FROM public.profiles WHERE id = user_id;
  RETURN COALESCE(result, 'user'::public.admin_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_admin_id uuid,
  p_action text,
  p_target_type text DEFAULT NULL,
  p_target_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}',
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' AND (
    p_admin_id IS DISTINCT FROM auth.uid()
    OR NOT public.has_admin_permission(auth.uid(), 'audit:view')
  ) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  INSERT INTO public.admin_audit_log
    (admin_id, action, target_type, target_id, metadata, ip_address, user_agent)
  VALUES
    (p_admin_id, left(p_action, 128), left(p_target_type, 64), left(p_target_id, 256),
     COALESCE(p_metadata, '{}'::jsonb), p_ip_address, left(p_user_agent, 512))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.has_admin_permission(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_permissions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_admin_action(uuid, text, text, text, jsonb, inet, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_to_admin(uuid, public.admin_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_admin_action(uuid, text, text, text, jsonb, inet, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_to_admin(uuid, public.admin_role) TO authenticated, service_role;
ALTER FUNCTION public.promote_to_admin(uuid, public.admin_role) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.award_gallery_points(uuid, text, text, integer, integer, integer, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlock_gallery_achievement(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_achievement_progress(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aggregate_game_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_gallery_points(uuid, text, text, integer, integer, integer, integer, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_gallery_achievement(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_achievement_progress(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aggregate_game_stats(uuid) TO service_role;

DROP POLICY IF EXISTS "Stats are public" ON public.player_stats;
CREATE POLICY "Stats respect profile visibility"
  ON public.player_stats FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = player_stats.user_id AND p.is_public = true
    )
  );

DROP POLICY IF EXISTS "Public read access for solo leaderboard" ON public.solo_leaderboard;
CREATE POLICY "Leaderboard respects profile visibility"
  ON public.solo_leaderboard FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = solo_leaderboard.user_id AND p.is_public = true
    )
  );
DROP POLICY IF EXISTS "Users can insert own scores" ON public.solo_leaderboard;
DROP POLICY IF EXISTS "Users can delete own scores" ON public.solo_leaderboard;

DROP POLICY IF EXISTS "Gallery stats are viewable by everyone" ON public.gallery_stats;
DROP POLICY IF EXISTS "Users can update their own gallery stats" ON public.gallery_stats;
DROP POLICY IF EXISTS "Users can insert their own gallery stats" ON public.gallery_stats;
CREATE POLICY "Gallery stats respect profile visibility"
  ON public.gallery_stats FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = gallery_stats.user_id AND p.is_public = true
    )
  );

DROP POLICY IF EXISTS "Achievements are viewable by everyone" ON public.gallery_achievements;
DROP POLICY IF EXISTS "Users can update their own achievements" ON public.gallery_achievements;
DROP POLICY IF EXISTS "Users can insert their own achievements" ON public.gallery_achievements;
CREATE POLICY "Users can view their own achievements"
  ON public.gallery_achievements FOR SELECT
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.gallery_stats FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.gallery_achievements FROM anon, authenticated;
REVOKE INSERT, DELETE ON public.solo_leaderboard FROM anon, authenticated;

ALTER VIEW public.gallery_leaderboard_weekly SET (security_invoker = true, security_barrier = true);
