-- ============================================================================
-- RPC persistence functions
-- ============================================================================
-- Run with: supabase test db
--
-- These tests verify:
-- 1. Atomic game creation with multiple players
-- 2. Idempotent game creation (retry safety)
-- 3. Atomic game completion with rankings
-- 4. Idempotent game completion (retry safety)
-- 5. Bulk domain event persistence with idempotency
-- 6. Empty event batches
--
-- Everything runs inside a transaction that is rolled back.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Players must exist in auth.users; the signup trigger creates their profiles.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rpc-host@example.com'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'rpc-player@example.com');

-- ===========================================================================
-- create_game_atomic
-- ===========================================================================

select is(
  (select row(r.success, r.affected_rows)::text
   from public.create_game_atomic(
     'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
     'TEST01',
     'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
     'multiplayer',
     '{"test": true}'::jsonb,
     array[
       row('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 0, 0, false)::public.game_player_input,
       row('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 1, 1, false)::public.game_player_input
     ]
   ) as r),
  '(t,3)',
  'create_game_atomic creates 1 game + 2 players'
);

select ok(
  exists(
    select 1 from public.games
    where id = 'bbbbbbbb-0000-4000-8000-000000000001' and status = 'active'
  ),
  'game record exists with active status'
);

select is(
  (select count(*)::int from public.game_players
   where game_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  2,
  'two player records exist'
);

select is(
  (select row(r.success, r.affected_rows)::text
   from public.create_game_atomic(
     'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
     'TEST01',
     'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
     'multiplayer',
     '{}'::jsonb,
     array[
       row('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 0, 0, false)::public.game_player_input
     ]
   ) as r),
  '(t,0)',
  'create_game_atomic retry is idempotent (success, 0 new rows)'
);

-- ===========================================================================
-- complete_game_atomic
-- ===========================================================================

select is(
  (select row(r.success, r.affected_rows)::text
   from public.complete_game_atomic(
     'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
     'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
     array[
       row('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 1, 285, '{"ones": 3, "twos": 6}'::jsonb, false)::public.player_ranking,
       row('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 2, 220, '{"ones": 2, "twos": 4}'::jsonb, false)::public.player_ranking
     ]
   ) as r),
  '(t,3)',
  'complete_game_atomic updates 1 game + 2 players'
);

select is(
  (select status from public.games
   where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'completed',
  'game status is completed'
);

select is(
  (select final_score from public.game_players
   where game_id = 'bbbbbbbb-0000-4000-8000-000000000001'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  285,
  'host final score is 285'
);

select is(
  (select final_score from public.game_players
   where game_id = 'bbbbbbbb-0000-4000-8000-000000000001'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  220,
  'player 2 final score is 220'
);

select is(
  (select r.success
   from public.complete_game_atomic(
     'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
     'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
     array[
       row('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 1, 999, '{}'::jsonb, false)::public.player_ranking
     ]
   ) as r),
  true,
  'complete_game_atomic retry is idempotent'
);

select is(
  (select final_score from public.game_players
   where game_id = 'bbbbbbbb-0000-4000-8000-000000000001'
     and user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  285,
  'host score unchanged after idempotent retry'
);

-- ===========================================================================
-- persist_domain_events
-- ===========================================================================

select is(
  (select row(r.success, r.affected_rows)::text
   from public.persist_domain_events(
     array[
       row('cccccccc-0000-4000-8000-000000000001'::uuid, 'GameStarted', '1.0.0', 0,
           'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           null, null, '{"test": 1}'::jsonb)::public.domain_event_input,
       row('cccccccc-0000-4000-8000-000000000002'::uuid, 'TurnScored', '1.0.0', 1,
           'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           1, null, '{"category": "ones"}'::jsonb)::public.domain_event_input
     ]
   ) as r),
  '(t,2)',
  'persist_domain_events inserts 2 events'
);

select is(
  (select row(r.success, r.affected_rows)::text
   from public.persist_domain_events(
     array[
       row('cccccccc-0000-4000-8000-000000000001'::uuid, 'GameStarted', '1.0.0', 0,
           'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           null, null, '{"test": 1}'::jsonb)::public.domain_event_input
     ]
   ) as r),
  '(t,0)',
  'persist_domain_events skips duplicate events'
);

select is(
  (select row(r.success, r.affected_rows)::text
   from public.persist_domain_events(array[]::public.domain_event_input[]) as r),
  '(t,0)',
  'persist_domain_events accepts an empty array'
);

select * from finish();
rollback;
