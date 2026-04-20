import React from "react";
import { isAuthDebugEnabledRuntime, useFrontendRuntimeSettings } from "./runtimeSettings";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_LOADED_ATTR = "data-turnstile-loaded";
let turnstileScriptPromise: Promise<void> | null = null;

export type TurnstileUiStatus =
  | "disabled"
  | "loading"
  | "waiting"
  | "verified"
  | "error"
  | "expired"
  | "retrying";

export function deriveTurnstileUiState(input: {
  enabled: boolean;
  ready: boolean;
  widgetRenderAttempted: boolean;
  tokenPresent: boolean;
  hasError: boolean;
  expired: boolean;
  callbackError: boolean;
  retrying: boolean;
}): {
  status: TurnstileUiStatus;
  guidanceMessage: string | null;
  canSubmit: boolean;
} {
  if (!input.enabled) {
    return { status: "disabled", guidanceMessage: null, canSubmit: true };
  }

  let status: TurnstileUiStatus = "waiting";
  if (input.hasError && input.expired) status = "expired";
  else if (input.hasError && input.callbackError) status = "error";
  else if (input.tokenPresent) status = "verified";
  else if (!input.ready || !input.widgetRenderAttempted) status = "loading";
  else if (input.retrying) status = "retrying";

  const guidanceMessage =
    status === "loading"
      ? "Loading security check…"
      : status === "retrying"
        ? "Verification failed. Please wait a few seconds while we retry."
        : status === "expired"
          ? "Security check expired. Please complete the new verification challenge."
          : status === "error"
            ? "Verification failed. Please wait a few seconds while we retry."
            : null;

  const canSubmit = input.ready && input.tokenPresent;
  return { status, guidanceMessage, canSubmit };
}

function ensureScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  const existing = document.getElementById(
    SCRIPT_ID,
  ) as HTMLScriptElement | null;
  if (existing) {
    if (existing.getAttribute(SCRIPT_LOADED_ATTR) === "true") {
      return Promise.resolve();
    }

    turnstileScriptPromise = new Promise((resolve, reject) => {
      const complete = () => {
        existing.setAttribute(SCRIPT_LOADED_ATTR, "true");
        turnstileScriptPromise = null;
        resolve();
      };

      existing.addEventListener("load", complete, { once: true });
      existing.addEventListener(
        "error",
        () => {
          turnstileScriptPromise = null;
          reject(new Error("Failed to load Turnstile script."));
        },
        { once: true },
      );

      if (window.turnstile) {
        complete();
      }
    });

    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.setAttribute(SCRIPT_LOADED_ATTR, "true");
      turnstileScriptPromise = null;
      resolve();
    };
    script.onerror = () => {
      turnstileScriptPromise = null;
      reject(new Error("Failed to load Turnstile script."));
    };
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

export function useTurnstileToken() {
  const [token, setToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [widgetRenderAttempted, setWidgetRenderAttempted] =
    React.useState(false);
  const [callbackState, setCallbackState] = React.useState<{
    success: boolean;
    error: boolean;
    expired: boolean;
  }>({
    success: false,
    error: false,
    expired: false,
  });
  const widgetIdRef = React.useRef<string | null>(null);
  const [containerNode, setContainerNode] =
    React.useState<HTMLDivElement | null>(null);
  const runtimeSettings = useFrontendRuntimeSettings();
  const siteKey = runtimeSettings.turnstileSiteKey;
  const authDebug = isAuthDebugEnabledRuntime();
  const scriptPresent =
    typeof document !== "undefined" &&
    Boolean(document.getElementById(SCRIPT_ID));
  const [retrying, setRetrying] = React.useState(false);

  React.useEffect(() => {
    if (!authDebug) return;
    console.info("[turnstile] mount", {
      enabled: Boolean(siteKey),
      windowTurnstileExists: Boolean(window.turnstile),
      scriptPresent,
      containerPresent: Boolean(containerNode),
    });
    return () => {
      console.info("[turnstile] cleanup", {
        widgetIdPresent: Boolean(widgetIdRef.current),
        windowTurnstileExists: Boolean(window.turnstile),
      });
    };
  }, [authDebug, siteKey, scriptPresent, containerNode]);

  React.useEffect(() => {
    if (!siteKey || !containerNode) {
      if (authDebug) {
        console.info("[turnstile] init skipped", {
          hasSiteKey: Boolean(siteKey),
          containerPresent: Boolean(containerNode),
          windowTurnstileExists: Boolean(window.turnstile),
          scriptPresent: Boolean(document.getElementById(SCRIPT_ID)),
        });
      }
      return;
    }

    let cancelled = false;
    setReady(false);
    setError(null);
    setToken(null);
    setRetrying(false);
    setWidgetRenderAttempted(false);
    setCallbackState({ success: false, error: false, expired: false });

    ensureScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerNode) return;
        setWidgetRenderAttempted(true);
        if (authDebug) {
          console.info("[turnstile] rendering widget", {
            containerPresent: Boolean(containerNode),
            windowTurnstileExists: Boolean(window.turnstile),
            scriptPresent: Boolean(document.getElementById(SCRIPT_ID)),
          });
        }
        widgetIdRef.current = window.turnstile.render(containerNode, {
          sitekey: siteKey,
          theme: "light",
          size: "flexible",
          callback: (value: string) => {
            setToken(value);
            setError(null);
            setRetrying(false);
            setCallbackState((previous) => ({ ...previous, success: true }));
            if (authDebug)
              console.info("[turnstile] callback success", {
                tokenPresent: Boolean(value),
              });
          },
          "expired-callback": () => {
            setToken(null);
            setError(
              "Security check expired. Please complete the new verification challenge.",
            );
            setRetrying(true);
            setCallbackState((previous) => ({ ...previous, expired: true }));
            if (authDebug) console.info("[turnstile] callback expired");
          },
          "error-callback": () => {
            setToken(null);
            setError(
              "Verification failed. Please wait a few seconds while we retry.",
            );
            setRetrying(true);
            setCallbackState((previous) => ({ ...previous, error: true }));
            if (authDebug) console.info("[turnstile] callback error");
          },
        });
        setReady(true);
      })
      .catch((err) => {
        setReady(false);
        setError(
          err instanceof Error ? err.message : "Turnstile script error.",
        );
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
      setReady(false);
    };
  }, [authDebug, siteKey, containerNode]);

  const reset = React.useCallback(() => {
    setToken(null);
    setError(null);
    setRetrying(false);
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  const TurnstileWidget = React.useCallback(
    () => <div ref={setContainerNode} className="min-h-16 w-full" />,
    [],
  );

  React.useEffect(() => {
    if (!ready || !siteKey) return;
    if (token) {
      setRetrying(false);
      return;
    }
    if (callbackState.error || callbackState.expired) {
      setRetrying(true);
    }
  }, [callbackState.error, callbackState.expired, ready, siteKey, token]);

  React.useEffect(() => {
    if (!authDebug) return;
    console.info("[turnstile] state", {
      enabled: Boolean(siteKey),
      ready,
      tokenPresent: Boolean(token),
      error,
      widgetRenderAttempted,
      callbackState,
      windowTurnstileExists: Boolean(window.turnstile),
      scriptPresent: Boolean(document.getElementById(SCRIPT_ID)),
      containerPresent: Boolean(containerNode),
    });
  }, [
    authDebug,
    siteKey,
    ready,
    token,
    error,
    widgetRenderAttempted,
    callbackState,
    containerNode,
  ]);
  const uiState = React.useMemo(
    () =>
      deriveTurnstileUiState({
        enabled: Boolean(siteKey),
        ready,
        widgetRenderAttempted,
        tokenPresent: Boolean(token),
        hasError: Boolean(error),
        expired: callbackState.expired,
        callbackError: callbackState.error,
        retrying,
      }),
    [
      callbackState.error,
      callbackState.expired,
      error,
      ready,
      retrying,
      siteKey,
      token,
      widgetRenderAttempted,
    ],
  );

  return {
    token,
    error,
    ready,
    reset,
    TurnstileWidget,
    enabled: Boolean(siteKey),
    status: uiState.status,
    guidanceMessage: uiState.guidanceMessage,
    canSubmit: uiState.canSubmit,
  };
}
