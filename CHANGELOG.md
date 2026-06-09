# Changelog

## v0.1.6

### What's Changed

**Sub-path deployment overhaul**

A rework of how `BASE_PATH` is handled for deployments behind a reverse proxy at a sub-path (e.g. `/strawdmin`).

- `BASE_PATH` is now resolved at runtime rather than baked in as a build-time env var, enabling more flexible deployments
- Navigation links throughout the app have been updated to use the dynamic `BASE_PATH` correctly
- `fetch()` calls are consistently prefixed via `lib/api-url.ts`
- Fixed JWT/cookie handling in the proxy so static asset paths are correctly excluded from auth checks
- Fixed a bracket-notation inconsistency in how `BASE_PATH` was accessed

**Docs & configuration**

- README updated with clearer reverse proxy instructions for sub-path deployments
- `docker-compose` updated to reflect the new configuration model
- `layout.tsx` now uses `dynamic` export for improved rendering compatibility

**Disclaimer**

- Added a disclaimer file covering software usage and liability
- Fixed typos and improved wording in the disclaimer

**Other**

- README spelling and description improvements

---

> **Upgrade note:** If you're deploying behind a sub-path, review the updated reverse proxy instructions in the README — the nginx configuration is now simpler (no trailing slash rewrite needed).
