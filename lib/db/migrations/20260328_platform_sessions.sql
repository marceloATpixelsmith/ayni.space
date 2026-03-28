create schema if not exists platform;

create table if not exists platform.sessions (
  sid text primary key,
  sess jsonb not null,
  expire timestamptz not null
);

create index if not exists sessions_expire_idx on platform.sessions(expire);

-- Move any legacy session rows from public.sessions into platform.sessions.
do $$
begin
  if to_regclass('public.sessions') is not null then
    execute $copy$
      insert into platform.sessions (sid, sess, expire)
      select sid, sess, expire
      from public.sessions
      on conflict (sid)
      do update set
        sess = excluded.sess,
        expire = excluded.expire
    $copy$;

    execute 'drop table public.sessions';
  end if;
end $$;
