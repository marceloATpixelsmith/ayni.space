-- Enforce case-insensitive email uniqueness safely.
-- This migration fails deterministically with a clear error when historical
-- case-colliding emails exist, so production rollouts do not fail unpredictably.
do $$
declare
  collision_count integer;
  sample_pairs text;
begin
  select count(*)
    into collision_count
  from (
    select lower(email)
    from platform.users
    group by lower(email)
    having count(*) > 1
  ) collisions;

  if collision_count > 0 then
    select string_agg(grouped.emails, '; ' order by grouped.normalized_email)
      into sample_pairs
    from (
      select
        lower(email) as normalized_email,
        string_agg(email, ', ' order by email) as emails
      from platform.users
      group by lower(email)
      having count(*) > 1
      limit 10
    ) grouped;

    raise exception using
      message = 'Cannot create users_email_lower_unique: case-colliding emails already exist.',
      detail = coalesce(sample_pairs, 'No sample collisions captured.'),
      hint = 'Resolve duplicates so each lower(email) is unique, then rerun this migration.';
  end if;
end
$$;

create unique index if not exists users_email_lower_unique on platform.users (lower(email));
