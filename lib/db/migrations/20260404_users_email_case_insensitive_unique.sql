-- Enforce case-insensitive email uniqueness at DB level.
create unique index if not exists users_email_lower_unique on platform.users (lower(email));
