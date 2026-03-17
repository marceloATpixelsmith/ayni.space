import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  website: z.string().url().optional().or(z.literal("")).transform(v => v || undefined),
});

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.string().min(2).max(30),
});

export const switchOrgSchema = z.object({
  orgId: z.string().uuid(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
});

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid input", details: result.error.errors });
    }
    req.body = result.data;
    next();
  };
}
