-- Signed-in reads of game_players, games, domain_events and rooms failed with
-- "infinite recursion detected in policy for relation game_players": the
-- game_players SELECT policy queried game_players, and the games SELECT policy
-- queried game_players back. is_game_participant reads game_players as its owner,
-- so the policies below no longer re-enter the game_players policy. Who can read
-- what is unchanged; the domain_events and rooms policies work again as written.
--
-- Applies alone, before or after 20260913000002_public_security_hardening.

CREATE OR REPLACE FUNCTION public.is_game_participant(p_game_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.game_players AS gp
    WHERE gp.game_id = p_game_id
      AND gp.user_id = (SELECT auth.uid())
  );
$$;

COMMENT ON FUNCTION public.is_game_participant(uuid) IS
  'True when the caller holds a human seat in the game. RLS policies use it to avoid game_players policy recursion.';

REVOKE ALL ON FUNCTION public.is_game_participant(uuid) FROM PUBLIC;
-- Policies run with the caller's privileges, so every role that reads these tables needs EXECUTE.
GRANT EXECUTE ON FUNCTION public.is_game_participant(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "View game participants" ON public.game_players;
CREATE POLICY "View game participants"
  ON public.game_players FOR SELECT
  USING (
    public.is_game_participant(game_players.game_id)
    OR EXISTS (
      SELECT 1 FROM public.games AS g
      WHERE g.id = game_players.game_id
        AND (
          g.status = 'waiting'
          OR ((g.settings->>'allowSpectators')::boolean = true AND g.status IN ('playing', 'completed'))
        )
    )
  );

DROP POLICY IF EXISTS "Players and spectators can view games" ON public.games;
CREATE POLICY "Players and spectators can view games"
  ON public.games FOR SELECT
  USING (
    public.is_game_participant(games.id)
    OR status = 'waiting'
    OR ((settings->>'allowSpectators')::boolean = true AND status IN ('playing', 'completed'))
  );
