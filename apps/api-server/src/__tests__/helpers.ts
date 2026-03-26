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

export function createMountedSessionApp(mounts: Array<{ path: string; router: Router }>, session: SessionShape = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { session: SessionShape }).session = {
      id: "test-session-id",
      destroy: (cb) => cb?.(),
      save: (cb) => cb?.(),
      regenerate: (cb) => cb?.(),
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
) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, body: payload };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

type RestoreFn = () => void;

export function patchProperty<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): RestoreFn {
  const original = target[key];
  target[key] = value;
  return () => {
    target[key] = original;
  };
}

export function ensureTestDatabaseEnv() {
  process.env["DATABASE_URL"] ??= "postgres://postgres:postgres@localhost:5432/ayni_test";
}
