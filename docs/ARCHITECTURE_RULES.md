==================================================
CODEX WORKING RULES (MANDATORY)
===============================

SOURCE CONTROL / BRANCHING

1. Always base work on the latest remote master.
2. Always pull and confirm the latest remote master state before making any changes.
3. Never reuse an existing branch.
4. Never branch from a codex/* branch.
5. Always create a fresh branch from current master.
6. Never create parallel PRs that modify the same files.
7. If a file must change again, it must be done in a new PR based on updated master.

DOCUMENTATION

8. Always read /docs/README.md before starting any non-trivial task.
9. For the area being modified, read ALL referenced docs listed in /docs/README.md before making changes.
10. Do not proceed with implementation if required docs have not been read.
11. Keep docs and code in sync. If behavior changes, update docs.
12. Do not guess architecture—derive it from docs and existing code.

SCHEMA / DATABASE / AUTH MODEL GOVERNANCE (CRITICAL)

13. The Drizzle schema files are the SINGLE SOURCE OF TRUTH for database structure. ([orm.drizzle.team][1])

14. Any change to architecture that affects data models MUST update ALL of the following in the SAME PR:

    * Drizzle schema files
    * database migrations
    * runtime code (API + frontend security layer)
    * tests and fixtures
    * docs

15. Do NOT preserve backward compatibility unless explicitly instructed.

16. Do NOT keep legacy enum values.

17. Do NOT keep deprecated columns.

18. Do NOT keep translation or mapping logic from old models to new ones.

19. Do NOT leave “temporary” schema fields in place.

20. If a column or concept is no longer part of the architecture:

    * REMOVE it from schema
    * REMOVE it from runtime
    * REMOVE it from validation
    * REMOVE it from tests
    * REMOVE it from docs

21. If enums change:

    * update schema enum definitions
    * generate proper migrations (do NOT rely on implicit behavior)
    * remove deprecated enum values explicitly
    * ensure runtime only accepts new values

22. Runtime code MUST ONLY accept values that exist in the current schema.

23. Fail closed on unknown or invalid config values.

24. Do NOT implement compatibility layers such as:

    * mapping old access_mode values to new ones
    * reading deprecated fields like tenancy_mode
    * fallback behavior for removed schema values

25. If schema and runtime are out of sync, FIX THE ROOT CAUSE — do not patch around it.

DEFINITION OF DONE (NON-NEGOTIABLE)

26. A task is NOT complete unless:

    * schema matches intended architecture
    * migrations match schema
    * runtime uses ONLY the new model
    * deprecated fields/values are removed (not translated)
    * tests reflect the new model
    * docs reflect the new model

27. If any of the above are missing, the task is incomplete.

==================================================

[1]: https://orm.drizzle.team/docs/sql-schema-declaration?utm_source=chatgpt.com "Schema - Drizzle ORM"
