-- player_stats becomes a derived projection, and games persist AI seats.
--
-- player_stats was maintained by increments from both aggregate_game_stats and
-- the aggregate-game-stats Edge Function, so every completed game was counted at
-- least twice, and again on each queue retry. The projection below recomputes
-- absolute values from completed games, so any number of runs gives the same row.
--
-- Game players and domain events are written by the Worker through PostgREST
-- JSON arrays. AI seats have no profile: user_id is NULL, is_ai is true, and
-- ai_profile names the AI profile. Completion matches AI rankings by seat_number.
--
-- This migration is independent of 20260913000002_public_security_hardening and
-- applies before or after it: it keeps aggregate_game_stats(uuid) and its
-- service_role-only grant, and does not touch the player_stats SELECT policy.

-- ---------------------------------------------------------------------------
-- AI seats
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_players
  ADD COLUMN is_ai boolean NOT NULL DEFAULT false,
  ADD COLUMN ai_profile text;

ALTER TABLE public.game_players DROP CONSTRAINT game_players_pkey;
ALTER TABLE public.game_players ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.game_players ADD CONSTRAINT game_players_pkey PRIMARY KEY (game_id, seat_number);
-- A human sits once per game; AI rows have NULL user_id and are not constrained.
CREATE UNIQUE INDEX game_players_game_user_key ON public.game_players (game_id, user_id);
ALTER TABLE public.game_players ADD CONSTRAINT game_players_seat_identity CHECK (
  (is_ai AND user_id IS NULL)
  OR (NOT is_ai AND user_id IS NOT NULL AND ai_profile IS NULL)
);

COMMENT ON COLUMN public.game_players.user_id IS 'Human player profile; NULL for AI seats';
COMMENT ON COLUMN public.game_players.is_ai IS 'True for AI seats, which have no profile';
COMMENT ON COLUMN public.game_players.ai_profile IS 'AI profile id for AI seats';

-- JSON callers that omit these attributes get NULL.
ALTER TYPE public.game_player_input ADD ATTRIBUTE ai_profile text;
ALTER TYPE public.player_ranking ADD ATTRIBUTE seat_number smallint;

CREATE OR REPLACE FUNCTION public.create_game_atomic(
  p_game_id uuid,
  p_room_code text,
  p_host_id uuid,
  p_game_mode text,
  p_settings jsonb,
  p_players public.game_player_input[]
)
RETURNS public.operation_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_player public.game_player_input;
  v_is_ai boolean;
  v_player_count integer := 0;
BEGIN
  IF p_game_id IS NULL THEN
    RETURN ROW(false, 'INVALID_INPUT', 'game_id is required', 0)::public.operation_result;
  END IF;

  IF p_game_mode IS NULL OR p_game_mode NOT IN ('solo', 'multiplayer', 'tutorial') THEN
    RETURN ROW(false, 'INVALID_INPUT', 'game_mode must be solo, multiplayer, or tutorial', 0)::public.operation_result;
  END IF;

  IF coalesce(array_length(p_players, 1), 0) < 1 THEN
    RETURN ROW(false, 'INVALID_INPUT', 'at least one player is required', 0)::public.operation_result;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_players) AS p
    WHERE p.seat_number IS NULL OR (NOT coalesce(p.is_ai, false) AND p.user_id IS NULL)
  ) THEN
    RETURN ROW(false, 'INVALID_INPUT', 'every seat needs seat_number, and human seats need user_id', 0)::public.operation_result;
  END IF;

  -- Idempotency: a retry of an already created game succeeds without changes.
  IF EXISTS (SELECT 1 FROM public.games WHERE id = p_game_id) THEN
    RETURN ROW(true, NULL, NULL, 0)::public.operation_result;
  END IF;

  INSERT INTO public.games (id, room_code, host_id, status, game_mode, settings, created_at, started_at)
  VALUES (p_game_id, p_room_code, p_host_id, 'active', p_game_mode,
          coalesce(p_settings, '{}'::jsonb), now(), now());

  FOREACH v_player IN ARRAY p_players
  LOOP
    v_is_ai := coalesce(v_player.is_ai, false);
    INSERT INTO public.game_players (
      game_id, user_id, is_ai, ai_profile, seat_number, turn_order, is_connected, joined_at
    ) VALUES (
      p_game_id,
      CASE WHEN v_is_ai THEN NULL ELSE v_player.user_id END,
      v_is_ai,
      CASE WHEN v_is_ai THEN v_player.ai_profile END,
      v_player.seat_number,
      coalesce(v_player.turn_order, v_player.seat_number),
      true,
      now()
    );
    v_player_count := v_player_count + 1;
  END LOOP;

  RETURN ROW(true, NULL, NULL, v_player_count + 1)::public.operation_result;

EXCEPTION
  WHEN unique_violation THEN
    RETURN ROW(false, 'DUPLICATE', 'Game or player record already exists', 0)::public.operation_result;
  WHEN foreign_key_violation THEN
    RETURN ROW(false, 'INVALID_REFERENCE', 'Referenced user does not exist', 0)::public.operation_result;
  WHEN OTHERS THEN
    RAISE LOG 'create_game_atomic error: % %', SQLSTATE, SQLERRM;
    RETURN ROW(false, SQLSTATE, SQLERRM, 0)::public.operation_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- player_stats projection
-- ---------------------------------------------------------------------------
-- Counted game: games.status = 'completed' and the user's human seat has a
-- final_score. Abandoned, active and unscored games are ignored.
-- Win: final_rank = 1 in a game with more than one seat, AI seats included.
-- Scorecard keys are the Worker Scorecard fields. A Dicee counts when the
-- dicee category scored 50; each 100 of diceeBonus is one bonus Dicee, and
-- dicees_rolled = Dicee games + bonus Dicees. An upper bonus counts when
-- ones..sixes total at least 63.
-- Decisions are TurnScored domain events of counted games that carry a boolean
-- was_optimal; avg_ev_loss averages max(ev_difference, 0) over them. Games
-- without such events contribute zero decisions.

CREATE OR REPLACE FUNCTION public.rebuild_player_stats(p_user_id uuid)
RETURNS public.player_stats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stats public.player_stats;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN NULL;
  END IF;

  -- Serialize rebuilds per user, so the last rebuild reads every earlier commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('public.player_stats:' || p_user_id::text, 0));

  WITH counted AS (
    SELECT
      gp.game_id,
      gp.final_score,
      gp.final_rank,
      CASE WHEN jsonb_typeof(gp.scorecard) = 'object' THEN gp.scorecard ELSE '{}'::jsonb END AS scorecard,
      (SELECT count(*) FROM public.game_players AS seat WHERE seat.game_id = gp.game_id) AS seat_count
    FROM public.game_players AS gp
    JOIN public.games AS g ON g.id = gp.game_id
    WHERE gp.user_id = p_user_id
      AND NOT gp.is_ai
      AND g.status = 'completed'
      AND gp.final_score IS NOT NULL
  ),
  numbers AS (
    SELECT c.game_id, e.key, (e.value #>> '{}')::numeric AS value
    FROM counted AS c
    CROSS JOIN LATERAL jsonb_each(c.scorecard) AS e
    WHERE jsonb_typeof(e.value) = 'number'
  ),
  per_game AS (
    SELECT
      c.game_id,
      coalesce(max(n.value) FILTER (WHERE n.key = 'dicee'), 0) = 50 AS scored_dicee,
      floor(coalesce(max(n.value) FILTER (WHERE n.key = 'diceeBonus'), 0) / 100)::int AS bonus_dicees,
      coalesce(sum(n.value) FILTER (
        WHERE n.key IN ('ones', 'twos', 'threes', 'fours', 'fives', 'sixes')
      ), 0) >= 63 AS upper_bonus
    FROM counted AS c
    LEFT JOIN numbers AS n ON n.game_id = c.game_id
    GROUP BY c.game_id
  ),
  totals AS (
    SELECT
      count(*)::int AS games,
      count(*) FILTER (WHERE c.final_rank = 1 AND c.seat_count > 1)::int AS wins,
      coalesce(sum(c.final_score), 0)::bigint AS total_score,
      coalesce(max(c.final_score), 0)::int AS best_score,
      (SELECT coalesce(sum(pg.bonus_dicees), 0)::int FROM per_game AS pg) AS bonus_dicees,
      (SELECT count(*) FILTER (WHERE pg.scored_dicee)::int FROM per_game AS pg) AS dicee_games,
      (SELECT count(*) FILTER (WHERE pg.upper_bonus)::int FROM per_game AS pg) AS upper_bonuses
    FROM counted AS c
  ),
  categories AS (
    SELECT coalesce(jsonb_object_agg(cat.key, jsonb_build_object(
      'times_scored', cat.times_scored,
      'total_score', cat.total_score,
      'best_score', cat.best_score,
      'avg_score', cat.avg_score
    )), '{}'::jsonb) AS category_stats
    FROM (
      SELECT n.key, count(*)::int AS times_scored, sum(n.value) AS total_score,
             max(n.value) AS best_score, round(avg(n.value), 2) AS avg_score
      FROM numbers AS n
      WHERE n.key IN ('ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
                      'threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight',
                      'largeStraight', 'dicee', 'chance')
      GROUP BY n.key
    ) AS cat
  ),
  decisions AS (
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE (e.payload ->> 'was_optimal')::boolean)::int AS optimal,
      coalesce(avg(CASE
        WHEN jsonb_typeof(e.payload -> 'ev_difference') = 'number'
          THEN greatest((e.payload ->> 'ev_difference')::numeric, 0)
        ELSE 0
      END), 0) AS avg_ev_loss
    FROM public.domain_events AS e
    JOIN counted AS c ON c.game_id = e.game_id
    WHERE e.player_id = p_user_id
      AND e.event_type = 'TurnScored'
      AND jsonb_typeof(e.payload -> 'was_optimal') = 'boolean'
  )
  INSERT INTO public.player_stats AS ps (
    user_id, games_played, games_won, games_completed, total_score, best_score, avg_score,
    dicees_rolled, bonus_dicees, upper_bonuses, category_stats,
    optimal_decisions, total_decisions, avg_ev_loss
  )
  SELECT
    p_user_id, t.games, t.wins, t.games, t.total_score, t.best_score,
    CASE WHEN t.games > 0 THEN round(t.total_score::numeric / t.games, 2) ELSE 0 END,
    t.dicee_games + t.bonus_dicees, t.bonus_dicees, t.upper_bonuses, cat.category_stats,
    d.optimal, d.total, least(round(d.avg_ev_loss, 2), 999.99)
  FROM totals AS t, categories AS cat, decisions AS d
  ON CONFLICT (user_id) DO UPDATE SET
    games_played = EXCLUDED.games_played,
    games_won = EXCLUDED.games_won,
    games_completed = EXCLUDED.games_completed,
    total_score = EXCLUDED.total_score,
    best_score = EXCLUDED.best_score,
    avg_score = EXCLUDED.avg_score,
    dicees_rolled = EXCLUDED.dicees_rolled,
    bonus_dicees = EXCLUDED.bonus_dicees,
    upper_bonuses = EXCLUDED.upper_bonuses,
    category_stats = EXCLUDED.category_stats,
    optimal_decisions = EXCLUDED.optimal_decisions,
    total_decisions = EXCLUDED.total_decisions,
    avg_ev_loss = EXCLUDED.avg_ev_loss
  -- Skip no-op writes, so a repeat run leaves the row, including updated_at, unchanged.
  WHERE (ps.games_played, ps.games_won, ps.games_completed, ps.total_score, ps.best_score,
         ps.avg_score, ps.dicees_rolled, ps.bonus_dicees, ps.upper_bonuses, ps.category_stats,
         ps.optimal_decisions, ps.total_decisions, ps.avg_ev_loss)
    IS DISTINCT FROM
        (EXCLUDED.games_played, EXCLUDED.games_won, EXCLUDED.games_completed, EXCLUDED.total_score,
         EXCLUDED.best_score, EXCLUDED.avg_score, EXCLUDED.dicees_rolled, EXCLUDED.bonus_dicees,
         EXCLUDED.upper_bonuses, EXCLUDED.category_stats, EXCLUDED.optimal_decisions,
         EXCLUDED.total_decisions, EXCLUDED.avg_ev_loss);

  SELECT * INTO v_stats FROM public.player_stats WHERE user_id = p_user_id;
  RETURN v_stats;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_player_stats_for_game(p_game_id uuid)
RETURNS SETOF public.player_stats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_stats public.player_stats;
BEGIN
  -- Fixed user order keeps advisory-lock acquisition deadlock-free.
  FOR v_user_id IN
    SELECT gp.user_id FROM public.game_players AS gp
    WHERE gp.game_id = p_game_id AND NOT gp.is_ai AND gp.user_id IS NOT NULL
    ORDER BY gp.user_id
  LOOP
    v_stats := public.rebuild_player_stats(v_user_id);
    IF v_stats.user_id IS NOT NULL THEN
      RETURN NEXT v_stats;
    END IF;
  END LOOP;
END;
$$;

-- Kept for the Worker queue and the public-hardening grants; now a projection refresh.
CREATE OR REPLACE FUNCTION public.aggregate_game_stats(p_game_id uuid)
RETURNS SETOF public.stats_update_result
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.user_id, s.games_played, s.games_won, ARRAY[]::text[]
  FROM public.refresh_player_stats_for_game(p_game_id) AS s;
$$;

DROP FUNCTION public.update_category_stats(jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.complete_game_atomic(
  p_game_id uuid,
  p_winner_id uuid,
  p_rankings public.player_ranking[],
  p_completed_at timestamptz DEFAULT now()
)
RETURNS public.operation_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ranking public.player_ranking;
  v_current_status text;
  v_updated_count integer := 0;
BEGIN
  SELECT status INTO v_current_status FROM public.games WHERE id = p_game_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN ROW(false, 'NOT_FOUND', 'Game does not exist', 0)::public.operation_result;
  END IF;

  -- Idempotency: a retry of an already completed game succeeds without changes.
  IF v_current_status = 'completed' THEN
    RETURN ROW(true, NULL, 'Already completed', 0)::public.operation_result;
  END IF;

  IF v_current_status <> 'active' THEN
    RETURN ROW(false, 'INVALID_STATE', 'Game is not active (status: ' || v_current_status || ')', 0)::public.operation_result;
  END IF;

  UPDATE public.games SET
    status = 'completed',
    winner_id = p_winner_id,
    completed_at = coalesce(p_completed_at, now())
  WHERE id = p_game_id;
  v_updated_count := 1;

  FOREACH v_ranking IN ARRAY coalesce(p_rankings, ARRAY[]::public.player_ranking[])
  LOOP
    UPDATE public.game_players SET
      final_score = v_ranking.score,
      final_rank = v_ranking.rank,
      scorecard = v_ranking.scorecard,
      is_connected = false,
      left_at = coalesce(left_at, p_completed_at, now())
    WHERE game_id = p_game_id
      AND CASE WHEN coalesce(v_ranking.is_ai, false)
            THEN is_ai AND seat_number = v_ranking.seat_number
            ELSE NOT is_ai AND user_id = v_ranking.player_id
          END;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ranking for % not found in game %',
        coalesce(v_ranking.player_id::text, 'AI seat ' || coalesce(v_ranking.seat_number::text, '?')),
        p_game_id;
    END IF;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  -- Refresh the projection in the same transaction, so stats never lag completion.
  PERFORM public.refresh_player_stats_for_game(p_game_id);

  RETURN ROW(true, NULL, NULL, v_updated_count)::public.operation_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'complete_game_atomic error: % %', SQLSTATE, SQLERRM;
    RETURN ROW(false, SQLSTATE, SQLERRM, 0)::public.operation_result;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_player_stats(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_player_stats_for_game(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aggregate_game_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_player_stats(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_player_stats_for_game(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aggregate_game_stats(uuid) TO service_role;

COMMENT ON TABLE public.player_stats IS
  'Derived projection of completed games; rebuild with public.rebuild_player_stats(user_id)';
COMMENT ON FUNCTION public.rebuild_player_stats(uuid) IS
  'Recomputes one user''s player_stats from completed games and domain events. Idempotent.';
COMMENT ON FUNCTION public.refresh_player_stats_for_game(uuid) IS
  'Rebuilds player_stats for every human seat of a game. Idempotent.';
COMMENT ON FUNCTION public.aggregate_game_stats(uuid) IS
  'Refreshes the player_stats projection for a game''s human seats. Idempotent.';
COMMENT ON FUNCTION public.create_game_atomic IS
  'Atomically creates a game with human and AI seats. Idempotent - safe to retry.';
COMMENT ON FUNCTION public.complete_game_atomic IS
  'Atomically completes a game, records seat results and refreshes player_stats. Idempotent.';

-- One-time rebuild: replaces previously inflated counts with projected values.
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN
    SELECT ps.user_id FROM public.player_stats AS ps
    UNION
    SELECT gp.user_id FROM public.game_players AS gp
    JOIN public.games AS g ON g.id = gp.game_id
    WHERE g.status = 'completed' AND NOT gp.is_ai AND gp.user_id IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM public.rebuild_player_stats(v_user_id);
  END LOOP;
END;
$$;
