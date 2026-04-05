import React from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_LOADED_ATTR = "data-turnstile-loaded";
let turnstileScriptPromise: Promise<void> | null = null;
const AUTH_DEBUG = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_AUTH_DEBUG === "true";

function ensureScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
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
      existing.addEventListener("error", () => {
        turnstileScriptPromise = null;
        reject(new Error("Failed to load Turnstile script."));
      }, { once: true });

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
  const [widgetRenderAttempted, setWidgetRenderAttempted] = React.useState(false);
  const [callbackState, setCallbackState] = React.useState<{ success: boolean; error: boolean; expired: boolean }>({
    success: false,
    error: false,
    expired: false,
  });
  const widgetIdRef = React.useRef<string | null>(null);
  const [containerNode, setContainerNode] = React.useState<HTMLDivElement | null>(null);

  const siteKey = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_TURNSTILE_SITE_KEY;
  const scriptPresent = typeof document !== "undefined" && Boolean(document.getElementById(SCRIPT_ID));

  React.useEffect(() => {
    if (!AUTH_DEBUG) return;
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
  }, [siteKey, scriptPresent, containerNode]);

  React.useEffect(() => {
    if (!siteKey || !containerNode) {
      if (AUTH_DEBUG) {
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
    setWidgetRenderAttempted(false);
    setCallbackState({ success: false, error: false, expired: false });

    ensureScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerNode) return;
        setWidgetRenderAttempted(true);
        if (AUTH_DEBUG) {
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
            setCallbackState((previous) => ({ ...previous, success: true }));
            if (AUTH_DEBUG) console.info("[turnstile] callback success", { tokenPresent: Boolean(value) });
          },
          "expired-callback": () => {
            setToken(null);
            setError("Verification expired. Please complete the challenge again.");
            setCallbackState((previous) => ({ ...previous, expired: true }));
            if (AUTH_DEBUG) console.info("[turnstile] callback expired");
          },
          "error-callback": () => {
            setToken(null);
            setError("Turnstile verification failed. Please retry.");
            setCallbackState((previous) => ({ ...previous, error: true }));
            if (AUTH_DEBUG) console.info("[turnstile] callback error");
          },
        });
        setReady(true);
      })
      .catch((err) => {
        setReady(false);
        setError(err instanceof Error ? err.message : "Turnstile script error.");
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
      setReady(false);
    };
  }, [siteKey, containerNode]);

  const reset = React.useCallback(() => {
    setToken(null);
    setError(null);
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  const TurnstileWidget = React.useCallback(
    () => <div ref={setContainerNode} className="min-h-16 w-full" />,
    [],
  );

  React.useEffect(() => {
    if (!AUTH_DEBUG) return;
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
  }, [siteKey, ready, token, error, widgetRenderAttempted, callbackState, containerNode]);

  return { token, error, ready, reset, TurnstileWidget, enabled: Boolean(siteKey) };
}
