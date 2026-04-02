-- Convert platform.apps.onboarding_mode from enum/text semantics to boolean.
-- App-level onboarding boolean semantics:
--  true  => solo app-level onboarding allowed
--  false => solo app-level onboarding blocked

alter table if exists platform.apps
  alter column onboarding_mode drop default,
  alter column onboarding_mode type boolean
  using (
    case
      when onboarding_mode::text in ('required', 'light') then true
      else false
    end
  ),
  alter column onboarding_mode set default true;

-- Remove legacy enum when no longer used.
do $$ begin
  if exists (select 1 from pg_type where typname = 'app_onboarding_mode') then
    drop type app_onboarding_mode;
  end if;
end $$;
