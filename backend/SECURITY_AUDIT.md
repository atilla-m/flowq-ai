# Git history audit — 2026-10-09

Scanned all 17 reachable commits and 116 distinct file blobs before the safety changes.

- Committed `.env`, `*.env`, or `.env.*` files (excluding `.env.example`): **none**.
- OpenAI secret-key format matches in historical file contents: **none**.
- Tracked environment templates: `backend/.env.example` and `frontend/.env.example`.

The repository-root `.gitignore` now excludes environment secrets, backend root database files, Python caches and eval output. Environment examples remain trackable.
