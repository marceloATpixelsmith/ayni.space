type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: { errors: Array<{ path: string; message: string }> } };

type Schema<T> = { safeParse(input: unknown): ValidationResult<T> };

function ok<T>(data: T): ValidationResult<T> {
  return { success: true, data };
}

function fail(path: string, message: string): ValidationResult<never> {
  return { success: false, error: { errors: [{ path, message }] } };
}

export const createOrgSchema: Schema<{ name: string; slug: string; website?: string }> = {
  safeParse(input) {
    if (!input || typeof input !== "object") return fail("body", "Body must be an object");
    const body = input as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const websiteRaw = body.website;

    if (name.length < 2 || name.length > 100) return fail("name", "Name must be between 2 and 100 characters");
    if (!/^[a-z0-9-]{2,50}$/.test(slug)) return fail("slug", "Slug must be 2-50 chars and use lowercase letters, numbers, hyphens");

    let website: string | undefined;
    if (websiteRaw !== undefined && websiteRaw !== "") {
      if (typeof websiteRaw !== "string") return fail("website", "Website must be a URL string");
      try {
        const parsed = new URL(websiteRaw);
        website = parsed.toString();
      } catch {
        return fail("website", "Website must be a valid URL");
      }
    }

    return ok({ name, slug, website });
  },
};

export const inviteSchema: Schema<{ email: string; role: string }> = {
  safeParse(input) {
    if (!input || typeof input !== "object") return fail("body", "Body must be an object");
    const body = input as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("email", "Email must be valid");
    if (role.length < 2 || role.length > 30) return fail("role", "Role must be between 2 and 30 characters");

    return ok({ email, role });
  },
};

export const switchOrgSchema: Schema<{ orgId: string }> = {
  safeParse(input) {
    if (!input || typeof input !== "object") return fail("body", "Body must be an object");
    const orgId = (input as Record<string, unknown>).orgId;
    const value = typeof orgId === "string" ? orgId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      return fail("orgId", "orgId must be a valid UUID");
    }
    return ok({ orgId: value });
  },
};

export const updateUserSchema: Schema<{ name?: string }> = {
  safeParse(input) {
    if (!input || typeof input !== "object") return fail("body", "Body must be an object");
    const name = (input as Record<string, unknown>).name;
    if (name === undefined) return ok({});
    if (typeof name !== "string") return fail("name", "Name must be a string");
    const value = name.trim();
    if (value.length < 2 || value.length > 100) return fail("name", "Name must be between 2 and 100 characters");
    return ok({ name: value });
  },
};

export function validateBody<T>(schema: Schema<T>) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid input", details: result.error.errors });
      return;
    }
    req.body = result.data;
    next();
  };
}
