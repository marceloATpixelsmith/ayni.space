import express, { type Router } from "express";

type SessionShape = {
  userId?: string;
  activeOrgId?: string;
  id?: string;
  destroy?: (cb?: (err?: unknown) => void) => void;
  save?: (cb?: (err?: unknown) => void) => void;
  regenerate?: (cb?: (err?: unknown) => void) => void;
  [key: string]: unknown;
};

export function createSessionApp(router: Router, session: SessionShape = {}) {
  return createMountedSessionApp([{ path: "/api", router }], session);
}

export function createStatefulSessionApp(
  mounts: Array<{ path: string; router: Router }>,
  persistedSession: SessionShape = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    persistedSession.id ??= "test-session-id";
    persistedSession.destroy = ((cb?: (err?: unknown) => void) => {
      for (const key of Object.keys(persistedSession)) {
        if (key === "destroy" || key === "save" || key === "regenerate") continue;
        delete persistedSession[key];
      }
      cb?.();
    }) as SessionShape["destroy"];
    persistedSession.save = ((cb?: (err?: unknown) => void) => {
      cb?.();
    }) as SessionShape["save"];
    persistedSession.regenerate = ((cb?: (err?: unknown) => void) => {
      for (const key of Object.keys(persistedSession)) {
        if (key === "destroy" || key === "save" || key === "regenerate") continue;
        delete persistedSession[key];
      }
      persistedSession.id = "regenerated-session-id";
      cb?.();
    }) as SessionShape["regenerate"];
    (req as unknown as { session: SessionShape }).session = persistedSession;
    next();
  });

  for (const mount of mounts) {
    app.use(mount.path, mount.router);
  }

  return app;
}

export function createMountedSessionApp(mounts: Array<{ path: string; router: Router }>, session: SessionShape = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: SessionShape }).session = {
      id: "test-session-id",
      destroy: ((cb?: (err?: unknown) => void) => {
        cb?.();
      }) as SessionShape["destroy"],
      save: ((cb?: (err?: unknown) => void) => {
        cb?.();
      }) as SessionShape["save"],
      regenerate: ((cb?: (err?: unknown) => void) => {
        cb?.();
      }) as SessionShape["regenerate"],
      ...session,
    };
    next();
  });

  for (const mount of mounts) {
    app.use(mount.path, mount.router);
  }

  return app;
}

export async function performJsonRequest(
  app: ReturnType<typeof createSessionApp>,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      redirect: "manual",
      headers: body
        ? { "content-type": "application/json", ...(headers ?? {}) }
        : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as any;
    return { status: response.status, body: payload, headers: response.headers };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

type RestoreFn = () => void;

export function patchProperty<T extends object, K extends keyof T>(target: T, key: K, value: unknown): RestoreFn {
  const original = target[key];
  (target as Record<K, unknown>)[key] = value;
  return () => {
    target[key] = original;
  };
}

export function ensureTestDatabaseEnv() {
  process.env["DATABASE_URL"] ??= "postgres://postgres:postgres@localhost:5432/ayni_test";
}
