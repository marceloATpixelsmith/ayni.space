-- Ensure deployed admin frontend (VITE_APP_SLUG=admin) resolves organization auth metadata from /api/apps.
update platform.apps
set access_mode = 'organization'::app_access_mode,
    is_active = true,
    updated_at = now()
where slug = 'admin';
