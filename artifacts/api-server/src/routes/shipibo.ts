import { Router, type IRouter } from "express";
import { db, shipiboWordsTable, shipiboCategoriesTable } from "@workspace/db";
import { eq, ilike, count, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

// ── GET /shipibo/words ────────────────────────────────────────────────────────
router.get("/words", requireAuth, async (req, res) => {
  const { q, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr) || 50, 200);
  const offset = parseInt(offsetStr) || 0;

  // Basic search or list
  const words = q
    ? await db.query.shipiboWordsTable.findMany({
        where: ilike(shipiboWordsTable.word, `%${q}%`),
        orderBy: desc(shipiboWordsTable.createdAt),
        limit,
        offset,
      })
    : await db.query.shipiboWordsTable.findMany({
        orderBy: desc(shipiboWordsTable.createdAt),
        limit,
        offset,
      });

  const [totalRow] = await db.select({ count: count() }).from(shipiboWordsTable);

  // Enrich with category names
  const categories = await db.query.shipiboCategoriesTable.findMany();
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  res.json({
    words: words.map((w) => ({
      id: w.id,
      word: w.word,
      translation: w.translation,
      definition: w.definition,
      pronunciation: w.pronunciation,
      partOfSpeech: w.partOfSpeech,
      categoryId: w.categoryId,
      categoryName: w.categoryId ? catMap.get(w.categoryId) ?? null : null,
      examples: w.examples,
      status: w.status,
      createdAt: w.createdAt,
    })),
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  });
});

// ── GET /shipibo/words/:wordId ─────────────────────────────────────────────────
router.get("/words/:wordId", requireAuth, async (req, res) => {
  const word = await db.query.shipiboWordsTable.findFirst({
    where: eq(shipiboWordsTable.id, req.params["wordId"]),
  });

  if (!word) {
    res.status(404).json({ error: "Word not found" });
    return;
  }

  let categoryName: string | null = null;
  if (word.categoryId) {
    const cat = await db.query.shipiboCategoriesTable.findFirst({
      where: eq(shipiboCategoriesTable.id, word.categoryId),
    });
    categoryName = cat?.name ?? null;
  }

  res.json({ ...word, categoryName });
});

// ── POST /shipibo/words ────────────────────────────────────────────────────────
router.post("/words", requireAuth, async (req, res) => {
  const { word, translation, definition, pronunciation, partOfSpeech, categoryId, examples } =
    req.body as {
      word: string;
      translation: string;
      definition?: string;
      pronunciation?: string;
      partOfSpeech?: string;
      categoryId?: string;
      examples?: string[];
    };

  if (!word || !translation) {
    res.status(400).json({ error: "word and translation are required" });
    return;
  }

  const [created] = await db
    .insert(shipiboWordsTable)
    .values({
      id: randomUUID(),
      word,
      translation,
      definition: definition ?? null,
      pronunciation: pronunciation ?? null,
      partOfSpeech: partOfSpeech ?? null,
      categoryId: categoryId ?? null,
      examples: examples ?? [],
      status: "draft",
      contributorUserId: req.session.userId ?? null,
    })
    .returning();

  res.status(201).json({ ...created, categoryName: null });
});

// ── GET /shipibo/categories ────────────────────────────────────────────────────
router.get("/categories", requireAuth, async (_req, res) => {
  const categories = await db.query.shipiboCategoriesTable.findMany();

  const categoriesWithCounts = await Promise.all(
    categories.map(async (cat) => {
      const [wordCount] = await db
        .select({ count: count() })
        .from(shipiboWordsTable)
        .where(eq(shipiboWordsTable.categoryId, cat.id));
      return {
        id: cat.id,
        name: cat.name,
        description: cat.description,
        wordCount: Number(wordCount?.count ?? 0),
      };
    })
  );

  res.json(categoriesWithCounts);
});

export default router;
