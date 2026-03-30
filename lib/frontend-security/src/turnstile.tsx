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
  const widgetIdRef = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const siteKey = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_TURNSTILE_SITE_KEY;

  React.useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let cancelled = false;
    setReady(false);
    setError(null);
    setToken(null);

    ensureScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerRef.current) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (value: string) => {
            setToken(value);
            setError(null);
          },
          "expired-callback": () => {
            setToken(null);
            setError("Verification expired. Please complete the challenge again.");
          },
          "error-callback": () => {
            setToken(null);
            setError("Turnstile verification failed. Please retry.");
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
  }, [siteKey]);

  const reset = React.useCallback(() => {
    setToken(null);
    setError(null);
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  const TurnstileWidget = React.useCallback(
    () => <div ref={containerRef} className="min-h-16" />,
    [],
  );

  return { token, error, ready, reset, TurnstileWidget, enabled: Boolean(siteKey) };
}
