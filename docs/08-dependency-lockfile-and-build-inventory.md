# 08 — Dependency, Lockfile, and Build Inventory (DRAFT)

## Confirmed from code

### Dependency/workspace conventions
- Root enforces pnpm usage (`preinstall` exits for non-pnpm agents).
- Single lockfile: `pnpm-lock.yaml`.
- Workspace package selection uses `pnpm-workspace.yaml` globs.
- Catalog/overrides are heavily used to pin versions and strip platform-specific optional binaries.

### Build/typecheck chain
- Root `build`: `typecheck` then recursive package builds.
- Root `typecheck` includes referenced libs + app/scripts package typechecks.
- API server has custom esbuild bundling script (`apps/api-server/build.ts`) outputting `dist/index.cjs`.
- DB package uses Drizzle Kit for schema push.
- API contract generation handled via Orval from `lib/api-spec`.

### Toolchain versions (as configured)
- Node target in CI: 22.
- TypeScript around 5.9.
- React 19 across Vite apps; Next app uses React 19.2 + Next 16.

## Strong inference from code structure
- Build process is optimized for monorepo reproducibility, but includes mixed build styles:
  - esbuild bundle for API server,
  - Vite for admin/mockup,
  - Next.js independent app.
- Dependency governance is centralized via catalog/overrides to control transitive variability.

## Unclear / requires confirmation
- Potential drift between documented Node versions (README/Replit docs mention different versions in places).
- Some README deployment commands reference outputs/paths that should be validated against current API build output.
- `frontend` app dependency graph is not lockfile-isolated but also not workspace-managed; confirm intended governance.
