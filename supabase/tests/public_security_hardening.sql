-- Public-release privacy and SECURITY DEFINER boundaries.
-- Run with: supabase test db
-- Fixtures are synthetic, and every change is rolled back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(99);

insert into auth.users (id, email, is_anonymous, raw_user_meta_data) values
  ('dddddddd-0000-4000-8000-000000000001', 'private-owner@example.com', false, '{"is_public":true}'),
  ('dddddddd-0000-4000-8000-000000000002', 'public-player@example.com', false, '{}'),
  ('dddddddd-0000-4000-8000-000000000003', 'private-admin@example.com', false, '{}'),
  ('dddddddd-0000-4000-8000-000000000004', null, true, '{"is_public":true}'),
  ('dddddddd-0000-4000-8000-000000000005', 'missing-profile@example.com', false, '{}');

select is(
  (select is_public from public.profiles where id = 'dddddddd-0000-4000-8000-000000000001'),
  false,
  'signup creates a private profile even when user metadata requests public visibility'
);
select is(
  (select row(is_anonymous, is_public)::text from public.profiles
   where id = 'dddddddd-0000-4000-8000-000000000004'),
  '(t,f)',
  'anonymous signup stays anonymous and private'
);

-- The application can recreate a missing profile without specifying visibility.
delete from public.profiles where id = 'dddddddd-0000-4000-8000-000000000005';
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok(
  $$insert into public.profiles (id, display_name)
    values ('dddddddd-0000-4000-8000-000000000005', 'Recreated')$$,
  'owner can recreate a missing profile using the visibility default'
);
select is(
  (select is_public from public.profiles where id = auth.uid()),
  false,
  'the table default also creates private profiles'
);
reset role;

select hasnt_column('public', 'bug_reports', column_name, column_name || ' is removed from bug reports')
from (values ('user_email'), ('user_display_name'), ('user_context'), ('console_capture'))
  as removed_columns(column_name);

update public.profiles set is_public = true, display_name = 'Public player'
where id = 'dddddddd-0000-4000-8000-000000000002';
update public.profiles set role = 'admin'
where id = 'dddddddd-0000-4000-8000-000000000003';

insert into public.player_stats (user_id, games_played)
select id, 1 from public.profiles
where id in ('dddddddd-0000-4000-8000-000000000001',
             'dddddddd-0000-4000-8000-000000000002',
             'dddddddd-0000-4000-8000-000000000003');
insert into public.solo_leaderboard (user_id, score)
select user_id, 100 from public.player_stats;
insert into public.gallery_stats (user_id, display_name, total_points)
select user_id, 'Synthetic player', 10 from public.player_stats;
insert into public.gallery_achievements (user_id, achievement_id, unlocked)
select user_id, 'synthetic-achievement', true from public.player_stats;

insert into public.games (id, status, completed_at, game_mode, host_id) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'completed', now(), 'solo',
   'dddddddd-0000-4000-8000-000000000001');
insert into public.game_players
  (game_id, user_id, seat_number, turn_order, final_score, final_rank, scorecard) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
   0, 0, 200, 1, '{"ones":3}');

-- A regular signed-in player sees their private data and explicitly public data.
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000001","role":"authenticated"}';

select results_eq(
  query,
  $$values ('dddddddd-0000-4000-8000-000000000001'::uuid),
           ('dddddddd-0000-4000-8000-000000000002'::uuid)$$,
  description
) from (values
  ('select id from public.profiles order by id', 'profiles hide another private account'),
  ('select user_id from public.player_stats order by user_id', 'player stats respect profile visibility'),
  ('select user_id from public.solo_leaderboard order by user_id', 'solo scores respect profile visibility'),
  ('select user_id from public.gallery_stats order by user_id', 'gallery stats respect profile visibility'),
  ('select user_id from public.gallery_leaderboard_weekly order by user_id', 'weekly view respects caller row visibility'),
  ('select user_id from public.get_daily_leaderboard() order by user_id', 'daily leaderboard RPC respects visibility'),
  ('select user_id from public.get_weekly_leaderboard() order by user_id', 'weekly leaderboard RPC respects visibility'),
  ('select user_id from public.get_alltime_leaderboard() order by user_id', 'all-time leaderboard RPC respects visibility')
) as visibility_queries(query, description);

select results_eq(
  $$select user_id from public.gallery_achievements order by user_id$$,
  $$values ('dddddddd-0000-4000-8000-000000000001'::uuid)$$,
  'achievements remain owner-only even for a public profile'
);
select is(
  (select achievement_count from public.gallery_leaderboard_weekly where user_id = auth.uid()),
  1::bigint,
  'weekly invoker view counts the caller own achievements'
);
select is(
  (select achievement_count from public.gallery_leaderboard_weekly
   where user_id = 'dddddddd-0000-4000-8000-000000000002'),
  0::bigint,
  'weekly invoker view does not disclose another player achievements'
);
select is(
  (select count(*)::int from public.get_user_best_scores('dddddddd-0000-4000-8000-000000000003')),
  0,
  'best-scores RPC cannot disclose a private account by user id'
);

select is(public.get_user_role(auth.uid()), 'user'::public.admin_role, 'caller can read their own role');
select is(public.has_admin_permission(auth.uid(), 'audit:view'), false, 'ordinary caller has no audit permission');
select is((select count(*)::int from public.get_user_permissions(auth.uid())), 0, 'ordinary caller has no admin permissions');
select is(
  public.has_admin_permission('dddddddd-0000-4000-8000-000000000003', 'audit:view'),
  false,
  'caller cannot probe another account admin permissions'
);
select throws_ok(query, 'P0001', 'permission denied', description)
from (values
  ($$select public.get_user_role('dddddddd-0000-4000-8000-000000000003')$$, 'caller cannot retrieve another account role'),
  ($$select public.get_user_permissions('dddddddd-0000-4000-8000-000000000003')$$, 'caller cannot retrieve another account permission list'),
  ($$select public.log_admin_action(auth.uid(), 'forged-self-action')$$, 'ordinary caller cannot create admin audit records'),
  ($$select public.log_admin_action('dddddddd-0000-4000-8000-000000000003', 'forged-other-action')$$, 'caller cannot impersonate another admin in the audit log')
) as forbidden_admin_calls(query, description);
select throws_ok(
  $$select public.promote_to_admin(auth.uid(), 'super_admin')$$,
  'P0001', 'Unauthorized: only super_admin can change roles',
  'ordinary caller cannot promote themselves through the privileged RPC'
);

select throws_ok(query, '42501', null, 'authenticated cannot execute ' || function_name)
from (values
  ('handle_new_user', $$select public.handle_new_user()$$),
  ('award_gallery_points', $$select public.award_gallery_points(auth.uid(), 'Forged', null, 999)$$),
  ('unlock_gallery_achievement', $$select public.unlock_gallery_achievement(auth.uid(), 'forged', 1)$$),
  ('update_achievement_progress', $$select public.update_achievement_progress(auth.uid(), 'forged', 999)$$),
  ('aggregate_game_stats', $$select public.aggregate_game_stats('eeeeeeee-0000-4000-8000-000000000001')$$)
) as forbidden_rpcs(function_name, query);

select throws_ok(query, '42501', null, 'authenticated cannot ' || operation)
from (values
  ('insert gallery stats', $$insert into public.gallery_stats (user_id, display_name) values (auth.uid(), 'Forged')$$),
  ('update gallery stats', $$update public.gallery_stats set total_points = 999 where user_id = auth.uid()$$),
  ('delete gallery stats', $$delete from public.gallery_stats where user_id = auth.uid()$$),
  ('insert achievements', $$insert into public.gallery_achievements (user_id, achievement_id) values (auth.uid(), 'forged')$$),
  ('update achievements', $$update public.gallery_achievements set progress = 999 where user_id = auth.uid()$$),
  ('delete achievements', $$delete from public.gallery_achievements where user_id = auth.uid()$$),
  ('insert solo scores', $$insert into public.solo_leaderboard (user_id, score) values (auth.uid(), 999)$$),
  ('delete solo scores', $$delete from public.solo_leaderboard where user_id = auth.uid()$$)
) as forbidden_mutations(operation, query);
with changed as (
  update public.solo_leaderboard set score = 999 where user_id = auth.uid() returning id
)
select is(
  (select count(*)::int from changed),
  0,
  'solo scores also cannot be changed through the existing UPDATE grant'
);

select lives_ok(
  $$insert into public.bug_reports (user_id, severity, title, description, breadcrumbs)
    values (auth.uid(), 'noticed', 'Synthetic report', 'Synthetic description', '[]')$$,
  'owner can submit a report using the remaining private fields'
);
select is((select count(*)::int from public.bug_reports), 1, 'owner can read their report');
select lives_ok(
  $$update public.profiles set is_public = true where id = auth.uid()$$,
  'owner can explicitly opt in to public visibility'
);

-- Anonymous sign-in is the authenticated database role, with its own user id.
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}';
select results_eq(
  query,
  $$values ('dddddddd-0000-4000-8000-000000000001'::uuid),
           ('dddddddd-0000-4000-8000-000000000002'::uuid)$$,
  description
) from (values
  ('select user_id from public.player_stats order by user_id', 'anonymous sign-in sees opted-in player stats'),
  ('select user_id from public.solo_leaderboard order by user_id', 'anonymous sign-in sees opted-in solo scores'),
  ('select user_id from public.gallery_stats order by user_id', 'anonymous sign-in sees opted-in gallery stats'),
  ('select user_id from public.gallery_leaderboard_weekly order by user_id', 'anonymous sign-in weekly view excludes private profiles')
) as guest_queries(query, description);
select is((select count(*)::int from public.gallery_achievements), 0, 'anonymous sign-in cannot see others achievements');
select is((select count(*)::int from public.bug_reports), 0, 'another signed-in user cannot see the private report');

-- No sign-in: the existing profiles policy is TO authenticated, so even public
-- profiles and their dependent stats are unavailable to the unauthenticated role.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is_empty(query, description)
from (values
  ('select id from public.profiles', 'anon cannot read profiles without a sign-in'),
  ('select user_id from public.player_stats', 'anon cannot bypass profile visibility through player stats'),
  ('select user_id from public.solo_leaderboard', 'anon cannot bypass profile visibility through solo scores'),
  ('select user_id from public.gallery_stats', 'anon cannot bypass profile visibility through gallery stats'),
  ('select user_id from public.gallery_achievements', 'anon cannot read achievements'),
  ('select user_id from public.gallery_leaderboard_weekly', 'weekly view does not bypass RLS for anon'),
  ('select id from public.bug_reports', 'anon cannot read private bug reports')
) as anon_queries(query, description);

select throws_ok(query, '42501', null, 'anon cannot execute ' || function_name)
from (values
  ('handle_new_user', $$select public.handle_new_user()$$),
  ('has_admin_permission', $$select public.has_admin_permission('dddddddd-0000-4000-8000-000000000003', 'audit:view')$$),
  ('get_user_permissions', $$select public.get_user_permissions('dddddddd-0000-4000-8000-000000000003')$$),
  ('get_user_role', $$select public.get_user_role('dddddddd-0000-4000-8000-000000000003')$$),
  ('log_admin_action', $$select public.log_admin_action('dddddddd-0000-4000-8000-000000000003', 'forged')$$),
  ('promote_to_admin', $$select public.promote_to_admin('dddddddd-0000-4000-8000-000000000001', 'super_admin')$$),
  ('award_gallery_points', $$select public.award_gallery_points('dddddddd-0000-4000-8000-000000000001', 'Forged', null, 999)$$),
  ('unlock_gallery_achievement', $$select public.unlock_gallery_achievement('dddddddd-0000-4000-8000-000000000001', 'forged', 1)$$),
  ('update_achievement_progress', $$select public.update_achievement_progress('dddddddd-0000-4000-8000-000000000001', 'forged', 999)$$),
  ('aggregate_game_stats', $$select public.aggregate_game_stats('eeeeeeee-0000-4000-8000-000000000001')$$)
) as forbidden_rpcs(function_name, query);

select throws_ok(query, '42501', null, 'anon cannot ' || operation)
from (values
  ('insert gallery stats', $$insert into public.gallery_stats (user_id, display_name) values ('dddddddd-0000-4000-8000-000000000001', 'Forged')$$),
  ('update gallery stats', $$update public.gallery_stats set total_points = 999$$),
  ('delete gallery stats', $$delete from public.gallery_stats$$),
  ('insert achievements', $$insert into public.gallery_achievements (user_id, achievement_id) values ('dddddddd-0000-4000-8000-000000000001', 'forged')$$),
  ('update achievements', $$update public.gallery_achievements set progress = 999$$),
  ('delete achievements', $$delete from public.gallery_achievements$$),
  ('insert solo scores', $$insert into public.solo_leaderboard (user_id, score) values ('dddddddd-0000-4000-8000-000000000001', 999)$$),
  ('delete solo scores', $$delete from public.solo_leaderboard$$)
) as forbidden_mutations(operation, query);
with changed as (update public.solo_leaderboard set score = 999 returning id)
select is(
  (select count(*)::int from changed),
  0,
  'anon cannot change solo scores through the existing UPDATE grant'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000003","role":"authenticated"}';
select is(public.get_user_role(auth.uid()), 'admin'::public.admin_role, 'admin can read their own role');
select is(public.has_admin_permission(auth.uid(), 'audit:view'), true, 'admin can check their own permissions');
select ok(
  exists(select 1 from public.get_user_permissions(auth.uid()) where permission = 'audit:view'),
  'admin can retrieve their own permission list'
);
select lives_ok(
  $$select public.log_admin_action(auth.uid(), repeat('a', 200), repeat('t', 100),
      repeat('i', 300), null, null, repeat('u', 600))$$,
  'authorized admin can log their own action'
);
select is(
  (select row(length(action), length(target_type), length(target_id), metadata, length(user_agent))::text
   from public.admin_audit_log where admin_id = auth.uid()),
  '(128,64,256,{},512)',
  'audit action bounds text fields and normalizes null metadata'
);
select throws_ok(
  $$select public.log_admin_action('dddddddd-0000-4000-8000-000000000001', 'impersonated')$$,
  'P0001', 'permission denied',
  'even an authorized admin cannot log an action as another account'
);

-- The trusted service role retains cross-user operations, without a user sub.
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  public.get_user_role('dddddddd-0000-4000-8000-000000000003'),
  'admin'::public.admin_role,
  'service role can retrieve another account role'
);
select is(
  public.has_admin_permission('dddddddd-0000-4000-8000-000000000003', 'audit:view'),
  true,
  'service role can check another account permissions'
);
select ok(
  exists(select 1 from public.get_user_permissions('dddddddd-0000-4000-8000-000000000003')
         where permission = 'audit:view'),
  'service role can retrieve another account permission list'
);
select lives_ok(
  $$select public.log_admin_action('dddddddd-0000-4000-8000-000000000001', 'trusted-service-action')$$,
  'service role can log a server action on behalf of an account'
);
select is(
  (select count(*)::int from public.admin_audit_log where action = 'trusted-service-action'),
  1,
  'trusted audit action persisted'
);
select is(
  public.award_gallery_points('dddddddd-0000-4000-8000-000000000001', 'Synthetic player', null, 7),
  7,
  'service role can award gallery points'
);
select is(
  (select total_points from public.gallery_stats where user_id = 'dddddddd-0000-4000-8000-000000000001'),
  17,
  'only trusted gallery points were added'
);
select is(
  public.unlock_gallery_achievement('dddddddd-0000-4000-8000-000000000001', 'trusted-unlock', 1),
  true,
  'service role can unlock an achievement'
);
select lives_ok(
  $$select public.update_achievement_progress('dddddddd-0000-4000-8000-000000000001', 'trusted-progress', 7)$$,
  'service role can update achievement progress'
);
select is(
  (select progress from public.gallery_achievements
   where user_id = 'dddddddd-0000-4000-8000-000000000001' and achievement_id = 'trusted-progress'),
  7,
  'trusted achievement progress persisted'
);
select is(
  (select count(*)::int from public.aggregate_game_stats('eeeeeeee-0000-4000-8000-000000000001')),
  1,
  'service role can aggregate a completed game'
);
select is(
  (select row(games_played, best_score)::text from public.player_stats
   where user_id = 'dddddddd-0000-4000-8000-000000000001'),
  '(2,200)',
  'untrusted calls did not aggregate or alter stats before the trusted call'
);
select lives_ok(
  $$insert into public.solo_leaderboard (user_id, score)
    values ('dddddddd-0000-4000-8000-000000000005', 200)$$,
  'service role retains trusted solo-score insertion'
);
select lives_ok(
  $$delete from public.solo_leaderboard where user_id = 'dddddddd-0000-4000-8000-000000000005'$$,
  'service role retains trusted solo-score deletion'
);
select is(
  (select count(*)::int from public.solo_leaderboard
   where user_id = 'dddddddd-0000-4000-8000-000000000005'),
  0,
  'trusted solo-score deletion persisted'
);

reset role;
select * from finish();
rollback;
