export const authEn = {
  auth_method_divider_or: "OR",
  login_title: "Welcome",
  login_subtitle_with_signup: "Sign in or create your account to continue.",
  login_subtitle_sign_in_only: "Sign in to continue.",
  login_google_sign_in_idle: "Sign in with Google",
  login_google_sign_in_loading: "Starting Google sign-in...",
  login_google_create_account_idle: "Create account with Google",
  login_google_create_account_loading: "Starting account setup...",
  login_email_placeholder: "Email",
  login_password_placeholder: "Password",
  login_email_button: "Sign in with email",
  login_create_account_link: "Create account",
  login_forgot_password_link: "Forgot password?",
  signup_title: "Create account",
  signup_subtitle: "Create your account to continue.",
  signup_email_placeholder: "Email",
  signup_password_placeholder: "Password",
  signup_email_button: "Sign up with email",
  signup_has_account_label: "Already have an account?",
  signup_sign_in_link: "Sign in",
  forgot_password_title: "Forgot password",
  forgot_password_subtitle:
    "Enter your email and we'll send reset instructions.",
  forgot_password_email_placeholder: "Email",
  forgot_password_submit_idle: "Send reset link",
  forgot_password_submit_loading: "Sending...",
  forgot_password_back_prompt: "Remembered your password?",
  forgot_password_back_link: "Back to sign in",
  forgot_password_success_generic:
    "If an account exists, a reset email has been sent.",
  forgot_password_test_reset_token: "Test reset token: {token}",
  forgot_password_error_fallback: "Unable to submit forgot-password request.",
  forgot_password_process_error: "Unable to process request.",
  reset_password_title: "Reset password",
  reset_password_subtitle:
    "Create a new strong password to secure your account.",
  reset_password_new_password_placeholder: "New password",
  reset_password_submit_button: "Reset password",
  reset_password_success_redirecting:
    "Password reset complete. Redirecting to login...",
  reset_password_error_fallback: "Unable to reset password.",
  validation_email_required: "Email is required.",
  validation_email_invalid: "Enter a valid email address.",
  validation_password_min_length: "Password must be at least 8 characters.",
  validation_password_letter: "Password must include at least 1 letter.",
  validation_password_uppercase:
    "Password must include at least 1 uppercase letter.",
  validation_password_lowercase:
    "Password must include at least 1 lowercase letter.",
  validation_password_number: "Password must include at least 1 number.",
  validation_password_special:
    "Password must include at least 1 special character.",
  auth_error_request_failed: "Request failed.",
  auth_error_turnstile_required: "Please complete the verification challenge.",
  auth_error_security_token_not_ready:
    "Security token is not ready. Please wait a moment and try again.",
  auth_error_security_token_not_ready_retry:
    "Security token is not ready. Please try again.",
  auth_error_security_token_refresh_invitation:
    "Security token is not ready. Please refresh and try accepting the invitation again.",
  auth_error_security_token_refresh_generic:
    "Security token is not ready. Please refresh and try again.",
  auth_error_security_token_refresh_sign_in:
    "Security token is not ready. Please refresh and try signing in again.",
  auth_error_security_token_refresh_signup:
    "Security token is not ready. Please refresh and try creating your account again.",
  auth_error_security_token_refresh_reset_password:
    "Security token is not ready. Please refresh and try resetting your password again.",
  auth_error_security_token_retry_verify_email:
    "Security token is not ready. Please retry the verification link.",
  auth_error_security_token_refresh_mfa_setup:
    "Security token is not ready. Please refresh and try two-step verification setup again.",
  auth_error_security_token_refresh_mfa:
    "Security token is not ready. Please refresh and try two-step verification again.",
  auth_error_security_token_refresh_recovery:
    "Security token is not ready. Please refresh and try recovery again.",
  login_error_verification_required:
    "Please complete verification before continuing.",
  login_error_network_unreachable:
    "Unable to reach the sign-in service. Please verify network/CORS configuration and try again.",
  login_error_google_start:
    "Unable to start Google sign-in right now. Please try again.",
  login_error_email_sign_in: "Unable to sign in.",
  login_error_invalid_credentials: "Invalid email or password.",
  login_error_routing_unresolved:
    "We could not complete sign-in routing safely. Please sign in again.",
  login_error_google_rate_limited: "Too many attempts. Please wait and retry.",
  login_error_google_rate_retry_seconds:
    " Please wait about {seconds} {unit} and retry.",
  login_error_google_rate_retry_moment: " Please wait a moment and retry.",
  login_error_google_verification_required:
    "Verification required. Please complete the challenge.",
  login_error_google_verification_expired:
    "Verification expired. Please complete the challenge again.",
  login_error_google_verification_failed:
    "Verification failed. Please try again.",
  login_error_google_verification_misconfigured:
    "Verification is temporarily unavailable due to configuration. Please contact support.",
  login_error_google_verification_unavailable:
    "Verification service is temporarily unavailable. Please try again.",
  login_error_google_config_unavailable:
    "Sign-in is temporarily unavailable due to configuration. Please contact support.",
  login_error_google_origin_not_allowed:
    "Access origin is not allowed for sign-in.",
  auth_error_app_context_missing:
    "Application context is missing. Please reload and try again.",
  auth_metadata_unavailable:
    "We could not load the sign-in configuration. Please try again later.",
  signup_error_fallback: "Unable to sign up.",

  verify_email_title: "Verify your email",
  verify_email_subtitle:
    "Confirm your email address to continue automatically.",
  verify_email_check_inbox: "Check your inbox to verify your email.",
  verify_email_sent_link_with_email:
    "We sent a verification link for {email}. After verification, we'll continue automatically.",
  verify_email_sent_link_without_email:
    "We sent a verification link. After verification, we'll continue automatically.",
  verify_email_verifying: "Verifying your email...",
  verify_email_redirecting: "Email verified. Redirecting...",
  verify_email_continuing: "Email verified. Continuing...",
  verify_email_failure_fallback: "Verification failed.",
  verify_email_link_already_used: "This verification link was already used.",
  verify_email_link_expired: "This verification link has expired.",
  verify_email_link_invalid: "This verification link is invalid.",
  verify_email_security_retry:
    "Security check failed. Please retry the verification link.",
  verify_email_unable: "Unable to verify email.",
  mfa_enroll_title: "Set up two-step verification",
  mfa_enroll_subtitle: "Add an authenticator app for extra account security.",
  mfa_enroll_preparing: "Preparing your authenticator setup…",
  mfa_enroll_init_error_fallback:
    "Unable to start two-step verification setup.",
  mfa_enroll_session_inactive:
    "Your session is no longer active. Please sign in again.",
  mfa_enroll_retry_setup: "Retry setup",
  mfa_enroll_step_download_app:
    "Download an authenticator app (Google Authenticator, 1Password, Authy, etc.).",
  mfa_enroll_step_scan_qr: "Scan the QR code shown below.",
  mfa_enroll_step_enter_first_code_prefix: "Enter the",
  mfa_enroll_step_enter_first_code_emphasis: "first code",
  mfa_enroll_step_enter_first_code_suffix:
    "generated by your authenticator app.",
  mfa_enroll_account_issuer: "Account issuer: {issuer}",
  mfa_enroll_qr_alt: "Two-step verification QR code",
  mfa_enroll_manual_setup:
    "Manual setup option: Enter this setup key manually in your authenticator app:",
  mfa_enroll_code_placeholder: "6-digit code",
  mfa_enroll_verify_fallback: "Unable to verify two-step verification code.",
  mfa_enroll_verify_loading: "Verifying…",
  mfa_enroll_verify_button: "Verify and activate two-step verification",
  mfa_enroll_recovery_codes_label: "Recovery codes (save these now):",
  mfa_enroll_continue_button: "Continue",
  mfa_enroll_redirecting_challenge:
    "Redirecting to two-step verification challenge.",
  mfa_enroll_recovery_codes_missing:
    "Two-step verification was activated, but recovery codes were not returned. Please contact support before continuing.",
  mfa_challenge_title: "Two-step verification required",
  mfa_challenge_subtitle:
    "Enter the code from your authenticator app to continue.",
  mfa_challenge_invalid_code: "Invalid two-step verification code.",
  mfa_challenge_invalid_recovery_code: "Invalid recovery code.",
  mfa_challenge_remember_browser:
    "Remember this browser for 20 days (skip MFA challenge on this browser).",
  mfa_challenge_stay_logged_in:
    "Keep this session signed in for up to 2 weeks.",
  mfa_challenge_code_placeholder: "6-digit authenticator code",
  mfa_challenge_verify_button: "Verify code",
  mfa_challenge_recovery_placeholder: "Recovery code",
  mfa_challenge_recovery_button: "Use recovery code",
  mfa_challenge_complete_fallback:
    "Unable to complete two-step verification challenge.",
  mfa_recovery_complete_fallback: "Unable to complete two-step recovery.",
  turnstile_loading: "Loading security check…",
  turnstile_retrying:
    "Verification failed. Please wait a few seconds while we retry.",
  turnstile_expired:
    "Security check expired. Please complete the new verification challenge.",
  turnstile_script_load_failed: "Failed to load Turnstile script.",
  turnstile_script_error: "Turnstile script error.",
  invitation_title: "Invitation",
  invitation_preparing: "Preparing invitation acceptance...",
  invitation_token_missing: "Invitation token is missing.",
  invitation_checking_status: "Checking invitation status...",
  invitation_resolve_error:
    "We couldn't load this invitation right now. Please retry.",
  invitation_resolve_state_error: "Unable to resolve invitation state.",
  invitation_resolve_payload_incomplete:
    "Invitation state payload was incomplete.",
  invitation_terminal_expired: "This invitation has expired.",
  invitation_terminal_accepted: "This invitation has already been accepted.",
  invitation_terminal_revoked: "This invitation has been revoked.",
  invitation_terminal_invalid: "This invitation is invalid.",
  invitation_set_password_message: "Set your password to join this invitation.",
  invitation_continue_message: "Continue to accept this invitation.",
  invitation_complete_verification:
    "Complete verification to accept this invitation.",
  invitation_accepting: "Accepting invitation...",
  invitation_accepted_redirecting: "Invitation accepted. Redirecting...",
  invitation_destination_unresolved:
    "Authenticated destination could not be resolved.",
  invitation_accept_failed: "Failed to accept invitation.",
  invitation_google_start_failed: "Unable to start Google sign-in.",
  invitation_password_set_failed: "Failed to set password.",
  invitation_back_sign_in: "Back to sign in",
  invitation_back_dashboard: "Back to dashboard",
  invitation_google_continue_idle: "Continue with Google",
  invitation_google_continue_loading: "Starting Google sign-in...",
  invitation_password_create_prompt: "Create a password to log in",
  invitation_password_placeholder: "Password",
  invitation_password_submitting: "Setting password...",
  invitation_password_submit: "Set password and join",
  invitation_email_sign_in_option: "Sign in with email/password",
  onboarding_user_title: "Complete your profile",
  onboarding_user_subtitle: "Tell us your name to continue to your dashboard.",
  onboarding_user_full_name_label: "Full name",
  onboarding_user_full_name_placeholder: "Jane Doe",
  onboarding_user_save_loading: "Saving...",
  onboarding_user_continue_button: "Continue to Dashboard",
  onboarding_org_name_min: "Organization name must be at least 2 characters",
  onboarding_org_slug_min: "Slug must be at least 2 characters",
  onboarding_org_slug_format:
    "Slug must contain only lowercase letters, numbers, and hyphens",
  onboarding_org_created: "Organization created successfully",
  onboarding_org_security_token_not_ready: "Security token not ready",
  onboarding_org_failed_create: "Failed to create organization",
  onboarding_org_retry_later: "Please try again in a moment.",
  onboarding_org_complete_verification: "Complete verification",
  onboarding_org_turnstile_required:
    "Please complete Turnstile verification before creating an organization.",
  onboarding_user_name_required: "Name is required",
  onboarding_user_name_required_description:
    "Please enter your full name to continue.",
  onboarding_user_save_failed: "Failed to save profile",
  onboarding_user_save_error: "Unable to save your profile.",
  onboarding_org_title: "Set up your workspace",
  onboarding_org_subtitle:
    "Create an organization to start using apps and inviting your team.",
  onboarding_org_name_label: "Organization Name",
  onboarding_org_name_placeholder: "Acme Corp",
  onboarding_org_url_label: "Workspace URL",
  onboarding_org_url_prefix: "app.platform.com/",
  onboarding_org_slug_placeholder: "acme-corp",
  onboarding_org_creating: "Creating...",
  onboarding_org_continue_button: "Continue to Dashboard",
} as const;
