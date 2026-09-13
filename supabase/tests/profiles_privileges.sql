-- ============================================================================
-- profiles column privileges (D-01 / SECURITY-01)
-- ============================================================================
-- Run with: supabase test db
--
-- Verifies that authenticated users (including anonymous sign-ins) cannot
-- change role, rating, badge or is_anonymous columns on their own profile,
-- that user-editable fields and preferences still update, that an owner-only
-- INSERT ... ON CONFLICT DO NOTHING works, and that is_anonymous is synced
-- from auth.users.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, is_anonymous) values
  ('11111111-1111-4111-8111-111111111111', 'profiles-owner@example.com', false),
  ('22222222-2222-4222-8222-222222222222', null, true),
  ('33333333-3333-4333-8333-333333333333', 'profiles-reinsert@example.com', false);

select is(
  (select row(role, is_anonymous)::text from public.profiles
   where id = '11111111-1111-4111-8111-111111111111'),
  '(user,f)',
  'signup trigger creates a user-role, non-anonymous profile'
);

select is(
  (select is_anonymous from public.profiles
   where id = '22222222-2222-4222-8222-222222222222'),
  true,
  'signup trigger marks anonymous sign-ins as anonymous'
);

-- ---------------------------------------------------------------------------
-- Catalog privileges
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'authenticated has no table-level UPDATE on profiles'
);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
  'authenticated has no table-level INSERT on profiles'
);

select ok(
  not has_any_column_privilege('anon', 'public.profiles', 'UPDATE'),
  'anon cannot UPDATE any profiles column'
);

select ok(
  not has_any_column_privilege('anon', 'public.profiles', 'INSERT'),
  'anon cannot INSERT any profiles column'
);

select is(
  array(
    select c from unnest(array[
      'id', 'role', 'skill_rating', 'rating_deviation', 'rating_volatility',
      'badges', 'is_anonymous', 'created_at', 'updated_at'
    ]) as c
    where has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE')
  ),
  array[]::text[],
  'authenticated cannot UPDATE protected profiles columns'
);

select is(
  array(
    select c from unnest(array[
      'role', 'skill_rating', 'rating_deviation', 'rating_volatility',
      'badges', 'is_anonymous', 'created_at', 'updated_at'
    ]) as c
    where has_column_privilege('authenticated', 'public.profiles', c, 'INSERT')
  ),
  array[]::text[],
  'authenticated cannot INSERT protected profiles columns'
);

select is(
  array(
    select c from unnest(array[
      'username', 'display_name', 'bio', 'avatar_seed', 'avatar_style',
      'is_public', 'last_seen_at', 'preferences'
    ]) as c
    where not has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE')
  ),
  array[]::text[],
  'authenticated can UPDATE user-editable profiles columns'
);

select ok(
  has_table_privilege('service_role', 'public.profiles', 'UPDATE'),
  'service_role keeps table-level UPDATE on profiles'
);

-- ---------------------------------------------------------------------------
-- Authenticated (permanent) user
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';

select throws_ok(
  $$update public.profiles set role = 'super_admin'
    where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null,
  'owner cannot update own role'
);

select throws_ok(
  $$update public.profiles set skill_rating = 3000
    where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null,
  'owner cannot update own skill_rating'
);

select throws_ok(
  $$update public.profiles set rating_deviation = 1, rating_volatility = 0.01
    where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null,
  'owner cannot update own rating_deviation or rating_volatility'
);

select throws_ok(
  $$update public.profiles set badges = '["forged"]'::jsonb
    where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null,
  'owner cannot update own badges'
);

select throws_ok(
  $$update public.profiles set is_anonymous = true
    where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null,
  'owner cannot update own is_anonymous'
);

select throws_ok(
  $$update public.profiles set display_name = 'Mixed', role = 'admin'
    where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null,
  'a mixed update that touches role is rejected as a whole'
);

select lives_ok(
  $$update public.profiles
    set username = 'profiles_owner',
        display_name = 'Owner',
        bio = 'Plays dice',
        avatar_seed = 'owner-seed',
        avatar_style = 'bottts',
        is_public = true,
        last_seen_at = now()
    where id = '11111111-1111-4111-8111-111111111111'$$,
  'owner can update user-editable profile fields'
);

select lives_ok(
  $$update public.profiles set preferences = '{"theme":"dark"}'::jsonb
    where id = '11111111-1111-4111-8111-111111111111'$$,
  'owner can update preferences'
);

select is(
  (select row(display_name, preferences->>'theme', role)::text from public.profiles
   where id = '11111111-1111-4111-8111-111111111111'),
  '(Owner,dark,user)',
  'profile field and preferences updates persisted and role is unchanged'
);

select lives_ok(
  $$insert into public.profiles (id, display_name)
    values ('11111111-1111-4111-8111-111111111111', 'Duplicate')
    on conflict (id) do nothing$$,
  'owner insert with ON CONFLICT DO NOTHING succeeds for an existing profile'
);

select is(
  (select display_name from public.profiles
   where id = '11111111-1111-4111-8111-111111111111'),
  'Owner',
  'ignored duplicate insert leaves the existing profile unchanged'
);

select throws_ok(
  $$insert into public.profiles (id, role)
    values ('11111111-1111-4111-8111-111111111111', 'super_admin')
    on conflict (id) do nothing$$,
  '42501', null,
  'owner cannot supply role on insert'
);

select throws_ok(
  $$insert into public.profiles (id, display_name)
    values ('11111111-1111-4111-8111-111111111111', 'Upsert')
    on conflict (id) do update set role = 'super_admin'$$,
  '42501', null,
  'owner cannot escalate role through ON CONFLICT DO UPDATE'
);

select lives_ok(
  $$update public.profiles set display_name = 'Hijacked'
    where id = '22222222-2222-4222-8222-222222222222'$$,
  'updating another user profile is filtered by RLS, not an error'
);

-- ---------------------------------------------------------------------------
-- Anonymous sign-in (authenticated role, is_anonymous claim)
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}';

select throws_ok(
  $$update public.profiles set role = 'super_admin'
    where id = '22222222-2222-4222-8222-222222222222'$$,
  '42501', null,
  'anonymous user cannot update own role'
);

select throws_ok(
  $$update public.profiles set is_anonymous = false
    where id = '22222222-2222-4222-8222-222222222222'$$,
  '42501', null,
  'anonymous user cannot update own is_anonymous'
);

select throws_ok(
  $$update public.profiles set badges = '["forged"]'::jsonb, skill_rating = 3000
    where id = '22222222-2222-4222-8222-222222222222'$$,
  '42501', null,
  'anonymous user cannot update own badges or skill_rating'
);

-- ---------------------------------------------------------------------------
-- Self-heal insert for a missing profile
-- ---------------------------------------------------------------------------

reset role;
delete from public.profiles where id = '33333333-3333-4333-8333-333333333333';

select is(
  (select display_name from public.profiles
   where id = '22222222-2222-4222-8222-222222222222'),
  null,
  'cross-user update did not change the other profile'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}';

select throws_ok(
  $$insert into public.profiles (id, display_name)
    values ('33333333-3333-4333-8333-333333333333', 'Not mine')
    on conflict (id) do nothing$$,
  '42501', null,
  'a user cannot insert a profile for another user'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';

select lives_ok(
  $$insert into public.profiles (id, display_name, is_public)
    values ('33333333-3333-4333-8333-333333333333', 'Reinserted', false)
    on conflict (id) do nothing$$,
  'owner can recreate a missing profile with ON CONFLICT DO NOTHING'
);

select is(
  (select row(role, is_anonymous, display_name)::text from public.profiles
   where id = '33333333-3333-4333-8333-333333333333'),
  '(user,f,Reinserted)',
  'recreated profile gets default role and server-derived is_anonymous'
);

-- ---------------------------------------------------------------------------
-- Server-side is_anonymous sync and service_role
-- ---------------------------------------------------------------------------

reset role;
update auth.users set is_anonymous = false
where id = '22222222-2222-4222-8222-222222222222';

select is(
  (select is_anonymous from public.profiles
   where id = '22222222-2222-4222-8222-222222222222'),
  false,
  'linking an identity syncs profiles.is_anonymous from auth.users'
);

set local role service_role;

select lives_ok(
  $$update public.profiles set role = 'moderator'
    where id = '33333333-3333-4333-8333-333333333333'$$,
  'service_role can still update role'
);

select is(
  (select role::text from public.profiles
   where id = '33333333-3333-4333-8333-333333333333'),
  'moderator',
  'service_role role update persisted'
);

reset role;

select * from finish();
rollback;
