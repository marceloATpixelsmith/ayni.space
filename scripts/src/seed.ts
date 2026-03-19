/**
 * Seed script: Creates initial platform data
 * Run with: pnpm --filter @workspace/scripts run seed
 *
 * Creates:
 * - 1 super admin user
 * - 2 apps (Shipibo Dictionary + Ayni)
 * - 1 organization (demo org)
 * - 1 subscriptions (Shipibo + Ayni)
 * - Sample Shipibo words and categories
 * - Sample Ayni ceremony
 */

import { db, usersTable, organizationsTable, orgMembershipsTable, appsTable, appPlansTable, subscriptionsTable, invitationsTable, shipiboCategoriesTable, userAppAccessTable, shipiboWordsTable, ayniCeremoniesTable, featureFlagsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { addDays } from "./seedHelpers.js";

async function seed() {
  console.log("🌱 Starting seed...");

  // ── SUPER ADMIN ────────────────────────────────────────────────────────────
  console.log("Creating super admin...");
  const adminId = randomUUID();
  await db.insert(usersTable).values({
    id: adminId,
    email: "admin@platform.dev",
    name: "Platform Admin",
    googleSubject: null,
    isSuperAdmin: true,
  }).onConflictDoNothing();

  // ── APPS ───────────────────────────────────────────────────────────────────
  console.log("Creating apps...");
  const shipiboAppId = "shipibo";
  const ayniAppId = "ayni";
  const adminAppId = "admin";

  await db.insert(appsTable).values([
    { id: adminAppId, name: "Admin", slug: "admin", accessMode: "restricted", tenancyMode: "none", onboardingMode: "disabled", invitesAllowed: false, isActive: true },
    { id: shipiboAppId, name: "Shipibo", slug: "shipibo", accessMode: "public_signup", tenancyMode: "solo", onboardingMode: "light", invitesAllowed: false, isActive: true },
    { id: ayniAppId, name: "Ayni", slug: "ayni", accessMode: "public_signup", tenancyMode: "organization", onboardingMode: "required", invitesAllowed: true, isActive: true },
  ]).onConflictDoNothing();

  // ── APP PLANS ──────────────────────────────────────────────────────────────
  console.log("Creating app plans...");
  await db.insert(appPlansTable).values([
    {
      id: "plan-shipibo-free",
      appId: shipiboAppId,
      name: "Free",
      priceMonthly: 0,
      features: ["Browse dictionary", "Basic search", "Up to 10 lists"],
      isActive: true,
    },
    {
      id: "plan-shipibo-pro",
      appId: shipiboAppId,
      name: "Pro",
      priceMonthly: 2900, // $29/month in cents
      features: ["Everything in Free", "Contribute words", "Unlimited lists", "Export data", "API access"],
      isActive: true,
    },
    {
      id: "plan-ayni-starter",
      appId: ayniAppId,
      name: "Starter",
      priceMonthly: 4900, // $49/month
      features: ["Up to 3 ceremonies/month", "50 participants per ceremony", "Basic forms", "Email notifications"],
      isActive: true,
    },
    {
      id: "plan-ayni-pro",
      appId: ayniAppId,
      name: "Pro",
      priceMonthly: 9900, // $99/month
      features: ["Unlimited ceremonies", "Unlimited participants", "Custom forms", "SMS notifications", "Analytics", "API access"],
      isActive: true,
    },
  ]).onConflictDoNothing();

  // ── ORGANIZATION ───────────────────────────────────────────────────────────
  console.log("Creating demo organization...");
  const orgId = "org-demo";
  await db.insert(organizationsTable).values({
    id: orgId,
    name: "Demo Organization",
    slug: "demo-org",
    website: "https://demo.example.com",
    appId: ayniAppId,
    ownerUserId: adminId,
  }).onConflictDoNothing();

  // ── MEMBERSHIPS ────────────────────────────────────────────────────────────
  console.log("Creating memberships...");
  await db.insert(orgMembershipsTable).values({
    id: randomUUID(),
    userId: adminId,
    orgId,
    role: "org_owner",
    membershipStatus: "active",
    joinedAt: new Date(),
  }).onConflictDoNothing();

  // Update admin's active org
  await db.update(usersTable)
    .set({ activeOrgId: orgId })
    .where(eq(usersTable.id, adminId));

  
  await db.insert(userAppAccessTable).values([
    { id: randomUUID(), userId: adminId, appId: adminAppId, role: "super_admin", accessStatus: "active" },
    { id: randomUUID(), userId: adminId, appId: ayniAppId, role: "org_owner", accessStatus: "active" },
    { id: randomUUID(), userId: adminId, appId: shipiboAppId, role: "solo_user", accessStatus: "active" },
  ]).onConflictDoNothing();

  // ── SUBSCRIPTIONS ──────────────────────────────────────────────────────────
  console.log("Creating subscriptions...");
  const now = new Date();
  const periodEnd = addDays(now, 30);

  await db.insert(subscriptionsTable).values([
    {
      id: "sub-demo-shipibo",
      orgId,
      appId: shipiboAppId,
      planId: "plan-shipibo-pro",
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    },
    {
      id: "sub-demo-ayni",
      orgId,
      appId: ayniAppId,
      planId: "plan-ayni-starter",
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    },
  ]).onConflictDoNothing();

  // ── PENDING INVITATION ─────────────────────────────────────────────────────
  console.log("Creating pending invitation...");
  await db.insert(invitationsTable).values({
    id: randomUUID(),
    email: "invited@example.com",
    orgId,
    appId: ayniAppId,
    invitedRole: "staff",
    token: "demo-invite-token-" + randomUUID(),
    invitationStatus: "pending",
    invitedByUserId: adminId,
    expiresAt: addDays(now, 7),
  }).onConflictDoNothing();

  // ── SHIPIBO CATEGORIES ──────────────────────────────────────────────────────
  console.log("Creating Shipibo categories...");
  const categories = [
    { id: "cat-nouns", name: "Nouns", description: "People, places, and things" },
    { id: "cat-verbs", name: "Verbs", description: "Actions and states" },
    { id: "cat-adj", name: "Adjectives", description: "Descriptive words" },
    { id: "cat-nature", name: "Nature", description: "Plants, animals, and natural phenomena" },
    { id: "cat-body", name: "Body Parts", description: "Human body vocabulary" },
    { id: "cat-food", name: "Food & Plants", description: "Traditional food and plant names" },
  ];
  await db.insert(shipiboCategoriesTable).values(categories).onConflictDoNothing();

  // ── SHIPIBO WORDS ──────────────────────────────────────────────────────────
  console.log("Creating sample Shipibo words...");
  await db.insert(shipiboWordsTable).values([
    {
      id: randomUUID(),
      word: "nete",
      translation: "sun / day",
      definition: "The sun, or the concept of a day",
      pronunciation: "NEH-teh",
      partOfSpeech: "noun",
      categoryId: "cat-nature",
      examples: ["Nete sharawe — The sun is bright", "Jato nete — Three days"],
      status: "published",
    },
    {
      id: randomUUID(),
      word: "joe",
      translation: "water",
      definition: "Water, also used for river",
      pronunciation: "hoe",
      partOfSpeech: "noun",
      categoryId: "cat-nature",
      examples: ["Joe shinan — Water flows"],
      status: "published",
    },
    {
      id: randomUUID(),
      word: "bari",
      translation: "moon",
      definition: "The moon",
      pronunciation: "BAH-ree",
      partOfSpeech: "noun",
      categoryId: "cat-nature",
      examples: [],
      status: "published",
    },
    {
      id: randomUUID(),
      word: "onanya",
      translation: "healer / shaman",
      definition: "A traditional healer or one who knows",
      pronunciation: "oh-NAN-ya",
      partOfSpeech: "noun",
      categoryId: "cat-nouns",
      examples: ["Onanya betan — With the healer"],
      status: "published",
    },
    {
      id: randomUUID(),
      word: "shipibo",
      translation: "monkey people (self-designation)",
      definition: "The name the Shipibo people use to refer to themselves",
      pronunciation: "shee-PEE-boh",
      partOfSpeech: "noun",
      categoryId: "cat-nouns",
      examples: [],
      status: "published",
    },
  ]).onConflictDoNothing();

  // ── AYNI CEREMONY ──────────────────────────────────────────────────────────
  console.log("Creating sample Ayni ceremony...");
  await db.insert(ayniCeremoniesTable).values({
    id: "ceremony-demo-1",
    orgId,
    name: "Spring Ceremony 2026",
    description: "A traditional spring gathering for healing and community",
    scheduledAt: addDays(now, 14),
    location: "Sacred Center, Peru",
    status: "scheduled",
    capacity: 20,
    createdByUserId: adminId,
  }).onConflictDoNothing();

  // ── FEATURE FLAGS ───────────────────────────────────────────────────────────
  console.log("Creating feature flags...");
  await db.insert(featureFlagsTable).values([
    { id: randomUUID(), key: "shipibo.comments", value: false, description: "Enable comments on word entries" },
    { id: randomUUID(), key: "shipibo.audio", value: false, description: "Enable audio pronunciation recordings" },
    { id: randomUUID(), key: "ayni.sms", value: false, description: "Enable SMS notifications for participants" },
    { id: randomUUID(), key: "platform.invitations", value: true, description: "Enable invitation system" },
  ]).onConflictDoNothing();

  console.log("✅ Seed complete!");
  console.log("\n📋 Seed data created:");
  console.log("  Super admin:   admin@platform.dev");
  console.log("  Organization:  Demo Organization (demo-org)");
  console.log("  Apps:          Shipibo Dictionary, Ayni Ceremony Management");
  console.log("  Subscriptions: Shipibo Pro + Ayni Starter (active)");
  console.log("  Shipibo words: 5 published words + 6 categories");
  console.log("  Ayni ceremony: Spring Ceremony 2026 (scheduled)");
  console.log("  Invited user:  invited@example.com (pending)");
  process.exit(0);
}

// Import eq here (needed for update)
import { eq } from "drizzle-orm";

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
