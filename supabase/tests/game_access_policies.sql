-- Game read policies: no recursion, and access is unchanged.
-- Run with: supabase test db
-- Fixtures are synthetic, and every change is rolled back.
--
-- Game ...01 is completed and private, with seats for players ...01 and ...02 and
-- one AI seat. Game ...02 is waiting, hosted by player ...03. Game ...03 is
-- completed with spectators allowed and seats only player ...02.

begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'access-1@example.com'),
  ('a0000000-0000-4000-8000-000000000002', 'access-2@example.com'),
  ('a0000000-0000-4000-8000-000000000003', 'access-3@example.com');

insert into public.games (id, status, game_mode, settings, host_id, completed_at) values
  ('a1000000-0000-4000-8000-000000000001', 'completed', 'multiplayer', '{}', 'a0000000-0000-4000-8000-000000000001', now()),
  ('a1000000-0000-4000-8000-000000000002', 'waiting', 'multiplayer', '{}', 'a0000000-0000-4000-8000-000000000003', null),
  ('a1000000-0000-4000-8000-000000000003', 'completed', 'multiplayer', '{"allowSpectators": true}', 'a0000000-0000-4000-8000-000000000002', now());

insert into public.game_players (game_id, user_id, is_ai, ai_profile, seat_number, turn_order) values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', false, null, 0, 0),
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', false, null, 1, 1),
  ('a1000000-0000-4000-8000-000000000001', null, true, 'carmen', 2, 2),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', false, null, 0, 0),
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', false, null, 0, 0);

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc as p
   where p.oid = 'public.is_game_participant(uuid)'::regprocedure),
  'is_game_participant is SECURITY DEFINER with an empty search_path'
);

select ok(
  has_function_privilege('anon', 'public.is_game_participant(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.is_game_participant(uuid)', 'execute'),
  'every reading role can execute the participation check the policies call'
);

-- ===========================================================================
-- Seated player
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok($$select count(*) from public.game_players$$, 'a signed-in player can read game_players');
select lives_ok($$select count(*) from public.domain_events$$, 'a signed-in player can read domain_events');
select lives_ok($$select count(*) from public.rooms$$, 'a signed-in player can read rooms');

select is(
  (select count(*)::int from public.game_players where game_id = 'a1000000-0000-4000-8000-000000000001'),
  3,
  'a seated player sees every seat of their game, AI seats included'
);

select is(
  (select count(*)::int from public.games
   where id in ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
                'a1000000-0000-4000-8000-000000000003')),
  3,
  'a seated player sees their game, a waiting game and a spectator-enabled game'
);

select is(
  (select count(*)::int from public.game_players where game_id = 'a1000000-0000-4000-8000-000000000003'),
  1,
  'seats of a completed spectator-enabled game are visible'
);

-- ===========================================================================
-- Signed-in outsider
-- ===========================================================================

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.game_players where game_id = 'a1000000-0000-4000-8000-000000000001'),
  0,
  'an outsider cannot see seats of a private completed game'
);

select is(
  (select count(*)::int from public.games where id = 'a1000000-0000-4000-8000-000000000001'),
  0,
  'an outsider cannot see a private completed game'
);

select is(
  (select count(*)::int from public.game_players where game_id = 'a1000000-0000-4000-8000-000000000002'),
  1,
  'a host sees the seats of their waiting game'
);

select is(
  public.is_game_participant('a1000000-0000-4000-8000-000000000001'),
  false,
  'the participation check reports only the caller''s own seats'
);

-- ===========================================================================
-- Anonymous
-- ===========================================================================

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select lives_ok($$select count(*) from public.game_players$$, 'an anonymous client can read game_players');

select is(
  (select count(*)::int from public.game_players where game_id = 'a1000000-0000-4000-8000-000000000001'),
  0,
  'an anonymous client cannot see seats of a private completed game'
);

select is(
  (select count(*)::int from public.games where id = 'a1000000-0000-4000-8000-000000000002'),
  1,
  'an anonymous client sees a waiting game'
);

reset role;

select * from finish();
rollback;
