-- player_stats projection, AI seats and projection grants.
-- Run with: supabase test db
-- Fixtures are synthetic, and every change is rolled back.
--
-- Players: ...01 plays against AI seats, a multiplayer game, a single-seat game,
-- an active game and an abandoned game; ...02 plays the multiplayer game and
-- beats an AI seat; ...03 has an inflated row and no games; ...04 has only an
-- abandoned game.

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000001', 'projection-1@example.com'),
  ('f0000000-0000-4000-8000-000000000002', 'projection-2@example.com'),
  ('f0000000-0000-4000-8000-000000000003', 'projection-3@example.com'),
  ('f0000000-0000-4000-8000-000000000004', 'projection-4@example.com');

-- ===========================================================================
-- AI seats
-- ===========================================================================

select is(
  (select row(r.success, r.affected_rows)::text
   from public.create_game_atomic(
     'f1000000-0000-4000-8000-000000000001', 'PROJ01', 'f0000000-0000-4000-8000-000000000001', 'solo', '{}',
     array[
       row('f0000000-0000-4000-8000-000000000001'::uuid, 0, 0, false, null)::public.game_player_input,
       row(null, 1, 1, true, 'carmen')::public.game_player_input,
       row(null, 2, 2, true, 'riley')::public.game_player_input
     ]) as r),
  '(t,4)',
  'a game with AI seats persists'
);

select results_eq(
  $$select seat_number::int, user_id, is_ai, ai_profile from public.game_players
    where game_id = 'f1000000-0000-4000-8000-000000000001' order by seat_number$$,
  $$values (0, 'f0000000-0000-4000-8000-000000000001'::uuid, false, null::text),
           (1, null::uuid, true, 'carmen'),
           (2, null::uuid, true, 'riley')$$,
  'AI seats have no profile and record their AI profile'
);

select throws_ok(
  $$insert into public.game_players (game_id, user_id, is_ai, seat_number, turn_order)
    values ('f1000000-0000-4000-8000-000000000001', null, false, 9, 9)$$,
  '23514', null,
  'a human seat requires a profile'
);

select throws_ok(
  $$insert into public.game_players (game_id, user_id, is_ai, seat_number, turn_order)
    values ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000004', true, 9, 9)$$,
  '23514', null,
  'an AI seat cannot reference a profile'
);

select is(
  (select row(r.success, r.error_code)::text
   from public.create_game_atomic(
     'f1000000-0000-4000-8000-0000000000ff', 'PROJFF', 'f0000000-0000-4000-8000-000000000001', 'solo', '{}',
     array[row(null, 0, 0, false, null)::public.game_player_input]) as r),
  '(f,INVALID_INPUT)',
  'create_game_atomic rejects a human seat without a user id'
);

select is(
  (select row(r.success, r.affected_rows)::text
   from public.complete_game_atomic(
     'f1000000-0000-4000-8000-000000000001', null,
     array[
       row('f0000000-0000-4000-8000-000000000001'::uuid, 2, 200,
           '{"ones":3,"twos":6,"threes":9,"fours":12,"fives":15,"sixes":18,"dicee":50,"diceeBonus":100,"upperBonus":35,"chance":20}'::jsonb,
           false, 0)::public.player_ranking,
       row(null, 1, 250, '{"ones":4}'::jsonb, true, 1)::public.player_ranking,
       row(null, 3, 150, '{"ones":1}'::jsonb, true, 2)::public.player_ranking
     ]) as r),
  '(t,4)',
  'complete_game_atomic records AI results by seat number'
);

select results_eq(
  $$select seat_number::int, final_rank::int, final_score from public.game_players
    where game_id = 'f1000000-0000-4000-8000-000000000001' order by seat_number$$,
  $$values (0, 2, 200), (1, 1, 250), (2, 3, 150)$$,
  'every seat of the AI game has its final result'
);

select is(
  (select row(games_played, games_won, total_score, optimal_decisions, total_decisions, avg_ev_loss)::text
   from public.player_stats where user_id = 'f0000000-0000-4000-8000-000000000001'),
  '(1,0,200,0,0,0.00)',
  'completion refreshes stats; losing to an AI seat is no win; no domain events means zero decisions'
);

select results_eq(
  $$select user_id from public.aggregate_game_stats('f1000000-0000-4000-8000-000000000001')$$,
  $$values ('f0000000-0000-4000-8000-000000000001'::uuid)$$,
  'aggregation projects human seats only'
);

-- ===========================================================================
-- More games and domain events
-- ===========================================================================

do $$
declare
  r public.operation_result;
begin
  -- Decision events for the AI game arrive after its completion, as in the Worker queue.
  r := public.persist_domain_events(array[
    row('f2000000-0000-4000-8000-000000000001'::uuid, 'TurnScored', '1.0', 0,
        'f1000000-0000-4000-8000-000000000001'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid,
        1, null, '{"was_optimal": true, "ev_difference": -2}'::jsonb)::public.domain_event_input
  ]);
  if not r.success then raise exception 'events G1: %', r; end if;

  -- G2: multiplayer, player 1 wins against player 2.
  r := public.create_game_atomic(
    'f1000000-0000-4000-8000-000000000002', 'PROJ02', 'f0000000-0000-4000-8000-000000000001', 'multiplayer', '{}',
    array[
      row('f0000000-0000-4000-8000-000000000001'::uuid, 0, 0, false, null)::public.game_player_input,
      row('f0000000-0000-4000-8000-000000000002'::uuid, 1, 1, false, null)::public.game_player_input
    ]);
  if not r.success then raise exception 'create G2: %', r; end if;
  r := public.persist_domain_events(array[
    row('f2000000-0000-4000-8000-000000000002'::uuid, 'TurnScored', '1.0', 0,
        'f1000000-0000-4000-8000-000000000002'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid,
        1, null, '{"was_optimal": true, "ev_difference": 0}'::jsonb)::public.domain_event_input,
    row('f2000000-0000-4000-8000-000000000003'::uuid, 'TurnScored', '1.0', 1,
        'f1000000-0000-4000-8000-000000000002'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid,
        2, null, '{"was_optimal": false, "ev_difference": 4.5}'::jsonb)::public.domain_event_input,
    row('f2000000-0000-4000-8000-000000000004'::uuid, 'TurnScored', '1.0', 2,
        'f1000000-0000-4000-8000-000000000002'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid,
        3, null, '{"category": "chance"}'::jsonb)::public.domain_event_input,
    row('f2000000-0000-4000-8000-000000000005'::uuid, 'DiceRolled', '1.0', 3,
        'f1000000-0000-4000-8000-000000000002'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid,
        3, 1, '{"was_optimal": false, "ev_difference": 9}'::jsonb)::public.domain_event_input
  ]);
  if not r.success then raise exception 'events G2: %', r; end if;
  r := public.complete_game_atomic(
    'f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001',
    array[
      row('f0000000-0000-4000-8000-000000000001'::uuid, 1, 300, '{"ones":2,"dicee":0,"chance":25}'::jsonb, false, 0)::public.player_ranking,
      row('f0000000-0000-4000-8000-000000000002'::uuid, 2, 180, '{"ones":4}'::jsonb, false, 1)::public.player_ranking
    ]);
  if not r.success then raise exception 'complete G2: %', r; end if;

  -- G3: a single-seat game, rank 1 but no opponent.
  r := public.create_game_atomic(
    'f1000000-0000-4000-8000-000000000003', 'PROJ03', 'f0000000-0000-4000-8000-000000000001', 'solo', '{}',
    array[row('f0000000-0000-4000-8000-000000000001'::uuid, 0, 0, false, null)::public.game_player_input]);
  if not r.success then raise exception 'create G3: %', r; end if;
  r := public.complete_game_atomic(
    'f1000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001',
    array[row('f0000000-0000-4000-8000-000000000001'::uuid, 1, 100, '{}'::jsonb, false, 0)::public.player_ranking]);
  if not r.success then raise exception 'complete G3: %', r; end if;

  -- G4: still active, with a stray final score.
  r := public.create_game_atomic(
    'f1000000-0000-4000-8000-000000000004', 'PROJ04', 'f0000000-0000-4000-8000-000000000001', 'solo', '{}',
    array[
      row('f0000000-0000-4000-8000-000000000001'::uuid, 0, 0, false, null)::public.game_player_input,
      row(null, 1, 1, true, 'carmen')::public.game_player_input
    ]);
  if not r.success then raise exception 'create G4: %', r; end if;
  update public.game_players set final_score = 999, final_rank = 1
  where game_id = 'f1000000-0000-4000-8000-000000000004';

  -- G5: abandoned, with stray final scores and a decision event.
  r := public.create_game_atomic(
    'f1000000-0000-4000-8000-000000000005', 'PROJ05', 'f0000000-0000-4000-8000-000000000001', 'multiplayer', '{}',
    array[
      row('f0000000-0000-4000-8000-000000000001'::uuid, 0, 0, false, null)::public.game_player_input,
      row('f0000000-0000-4000-8000-000000000004'::uuid, 1, 1, false, null)::public.game_player_input
    ]);
  if not r.success then raise exception 'create G5: %', r; end if;
  update public.game_players set final_score = 500, final_rank = 1
  where game_id = 'f1000000-0000-4000-8000-000000000005';
  r := public.persist_domain_events(array[
    row('f2000000-0000-4000-8000-000000000006'::uuid, 'TurnScored', '1.0', 0,
        'f1000000-0000-4000-8000-000000000005'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid,
        1, null, '{"was_optimal": false, "ev_difference": 10}'::jsonb)::public.domain_event_input
  ]);
  if not r.success then raise exception 'events G5: %', r; end if;
  r := public.abandon_game_atomic('f1000000-0000-4000-8000-000000000005', 'test');
  if not r.success then raise exception 'abandon G5: %', r; end if;

  -- G6: player 2 beats an AI seat.
  r := public.create_game_atomic(
    'f1000000-0000-4000-8000-000000000006', 'PROJ06', 'f0000000-0000-4000-8000-000000000002', 'solo', '{}',
    array[
      row('f0000000-0000-4000-8000-000000000002'::uuid, 0, 0, false, null)::public.game_player_input,
      row(null, 1, 1, true, 'carmen')::public.game_player_input
    ]);
  if not r.success then raise exception 'create G6: %', r; end if;
  r := public.complete_game_atomic(
    'f1000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000002',
    array[
      row('f0000000-0000-4000-8000-000000000002'::uuid, 1, 260, '{"ones":5}'::jsonb, false, 0)::public.player_ranking,
      row(null, 2, 200, '{"ones":1}'::jsonb, true, 1)::public.player_ranking
    ]);
  if not r.success then raise exception 'complete G6: %', r; end if;

  -- The queued aggregation for G1 runs once its events are persisted.
  perform public.aggregate_game_stats('f1000000-0000-4000-8000-000000000001');
end;
$$;

-- ===========================================================================
-- Projection values and win rule
-- ===========================================================================

select is(
  (select row(games_played, games_won, games_completed, total_score, best_score, avg_score,
              dicees_rolled, bonus_dicees, upper_bonuses, optimal_decisions, total_decisions, avg_ev_loss)::text
   from public.player_stats where user_id = 'f0000000-0000-4000-8000-000000000001'),
  '(3,1,3,600,300,200.00,2,1,1,2,3,1.50)',
  'AI, multiplayer and single-seat games project absolute totals; active and abandoned games are ignored'
);

select is(
  (select category_stats from public.player_stats where user_id = 'f0000000-0000-4000-8000-000000000001'),
  '{"ones":   {"times_scored": 2, "total_score": 5,  "best_score": 3,  "avg_score": 2.5},
    "twos":   {"times_scored": 1, "total_score": 6,  "best_score": 6,  "avg_score": 6},
    "threes": {"times_scored": 1, "total_score": 9,  "best_score": 9,  "avg_score": 9},
    "fours":  {"times_scored": 1, "total_score": 12, "best_score": 12, "avg_score": 12},
    "fives":  {"times_scored": 1, "total_score": 15, "best_score": 15, "avg_score": 15},
    "sixes":  {"times_scored": 1, "total_score": 18, "best_score": 18, "avg_score": 18},
    "dicee":  {"times_scored": 2, "total_score": 50, "best_score": 50, "avg_score": 25},
    "chance": {"times_scored": 2, "total_score": 45, "best_score": 25, "avg_score": 22.5}}'::jsonb,
  'category stats cover scoring categories of counted games only'
);

select is(
  (select games_won from public.player_stats where user_id = 'f0000000-0000-4000-8000-000000000001'),
  1,
  'win rule: rank 1 with more than one seat; a single-seat game and a loss to an AI seat are not wins'
);

select is(
  (select row(games_played, games_won, total_score, best_score, avg_score,
              optimal_decisions, total_decisions, avg_ev_loss)::text
   from public.player_stats where user_id = 'f0000000-0000-4000-8000-000000000002'),
  '(2,1,440,260,220.00,0,0,0.00)',
  'multiplayer loss plus a win against an AI seat; no decision events means zero decision metrics'
);

select is(
  (select row(r.games_played, r.total_score)::text
   from public.rebuild_player_stats('f0000000-0000-4000-8000-000000000004') as r),
  '(0,0)',
  'a player with only an abandoned game has no counted games'
);

-- ===========================================================================
-- Idempotence
-- ===========================================================================

create temporary table projection_snapshot on commit drop as
select ps.user_id, ps.ctid::text as tid, to_jsonb(ps) as stats
from public.player_stats as ps
where ps.user_id in ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002');

do $$
begin
  perform public.rebuild_player_stats('f0000000-0000-4000-8000-000000000001');
  perform public.rebuild_player_stats('f0000000-0000-4000-8000-000000000001');
  perform public.refresh_player_stats_for_game('f1000000-0000-4000-8000-000000000006');
end;
$$;

select is(
  (select jsonb_agg(to_jsonb(ps) order by ps.user_id) from public.player_stats as ps
   where ps.user_id in ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002')),
  (select jsonb_agg(stats order by user_id) from projection_snapshot),
  'running the projection again gives identical rows'
);

select is(
  (select array_agg(ps.ctid::text order by ps.user_id) from public.player_stats as ps
   where ps.user_id in ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002')),
  (select array_agg(tid order by user_id) from projection_snapshot),
  'a repeat run does not rewrite unchanged rows'
);

-- Simulated queue retry of every G2 task: completion, events, aggregation.
do $$
declare
  r public.operation_result;
begin
  perform public.aggregate_game_stats('f1000000-0000-4000-8000-000000000002');
  r := public.complete_game_atomic(
    'f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001',
    array[
      row('f0000000-0000-4000-8000-000000000001'::uuid, 1, 300, '{"ones":2,"dicee":0,"chance":25}'::jsonb, false, 0)::public.player_ranking,
      row('f0000000-0000-4000-8000-000000000002'::uuid, 2, 180, '{"ones":4}'::jsonb, false, 1)::public.player_ranking
    ]);
  if not r.success then raise exception 'retry complete G2: %', r; end if;
  r := public.persist_domain_events(array[
    row('f2000000-0000-4000-8000-000000000002'::uuid, 'TurnScored', '1.0', 0,
        'f1000000-0000-4000-8000-000000000002'::uuid, 'f0000000-0000-4000-8000-000000000001'::uuid,
        1, null, '{"was_optimal": true, "ev_difference": 0}'::jsonb)::public.domain_event_input
  ]);
  if not r.success or r.affected_rows <> 0 then raise exception 'retry events G2: %', r; end if;
  perform public.aggregate_game_stats('f1000000-0000-4000-8000-000000000002');
  perform public.refresh_player_stats_for_game('f1000000-0000-4000-8000-000000000002');
end;
$$;

select is(
  (select jsonb_agg(to_jsonb(ps) order by ps.user_id) from public.player_stats as ps
   where ps.user_id in ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002')),
  (select jsonb_agg(stats order by user_id) from projection_snapshot),
  'a retried completion, event batch and aggregation leave rows identical'
);

-- ===========================================================================
-- One-time rebuild (the statement the migration runs)
-- ===========================================================================

update public.player_stats
set games_played = 6, games_won = 2, games_completed = 6, total_score = 1200,
    optimal_decisions = 4, total_decisions = 6, category_stats = '{"ones": {"attempts": 4}}'
where user_id = 'f0000000-0000-4000-8000-000000000001';
insert into public.player_stats (user_id, games_played, games_won, total_score, optimal_decisions, total_decisions)
values ('f0000000-0000-4000-8000-000000000003', 9, 9, 999, 5, 10);

do $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select ps.user_id from public.player_stats as ps
    union
    select gp.user_id from public.game_players as gp
    join public.games as g on g.id = gp.game_id
    where g.status = 'completed' and not gp.is_ai and gp.user_id is not null
    order by 1
  loop
    perform public.rebuild_player_stats(v_user_id);
  end loop;
end;
$$;

select is(
  (select to_jsonb(ps) - 'updated_at' from public.player_stats as ps
   where ps.user_id = 'f0000000-0000-4000-8000-000000000001'),
  (select stats - 'updated_at' from projection_snapshot
   where user_id = 'f0000000-0000-4000-8000-000000000001'),
  'the one-time rebuild replaces an inflated row with projected values'
);

select is(
  (select row(games_played, games_won, total_score, optimal_decisions, total_decisions, category_stats)::text
   from public.player_stats where user_id = 'f0000000-0000-4000-8000-000000000003'),
  '(0,0,0,0,0,{})',
  'the one-time rebuild zeroes an inflated row without counted games'
);

-- ===========================================================================
-- Grants and row security
-- ===========================================================================

select ok(
  not has_function_privilege(role_name, function_signature, 'execute'),
  role_name || ' cannot execute ' || function_signature
)
from (values ('anon'), ('authenticated')) as roles(role_name)
cross join (values
  ('public.rebuild_player_stats(uuid)'),
  ('public.refresh_player_stats_for_game(uuid)'),
  ('public.aggregate_game_stats(uuid)')
) as functions(function_signature);

select ok(
  has_function_privilege('service_role', function_signature, 'execute'),
  'service_role can execute ' || function_signature
)
from (values
  ('public.rebuild_player_stats(uuid)'),
  ('public.refresh_player_stats_for_game(uuid)'),
  ('public.aggregate_game_stats(uuid)')
) as functions(function_signature);

select hasnt_function('public', 'update_category_stats', 'the incremental category helper is removed');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$insert into public.game_players (game_id, user_id, is_ai, ai_profile, seat_number, turn_order)
    values ('f1000000-0000-4000-8000-000000000001', null, true, 'forged', 7, 7)$$,
  '42501', null,
  'a signed-in player cannot insert an AI seat'
);
reset role;

select * from finish();
rollback;
