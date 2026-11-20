# Verification record — 20 November 2026

- Runtime: Node.js v24.22.3.
- `npm run check`: passed (TypeScript, Vite production build and tests).
- Tests: **19 passed, 0 failed**.
- Production process: bound to the supplied port on `0.0.0.0`, returned HTTP 200 from `/api/health`, and exited cleanly after SIGTERM with the database closed.
- Deployment tests: invalid production settings and demo databases are rejected; exact-origin checks, secure cookie attributes, logout, login throttling, proxy forwarding and SQLite/session persistence after restart passed.
- Domain tests cover authentication, roles, organization isolation and the rules described in README.md.
- `npm audit --omit=dev --audit-level=high`: reported 0 known vulnerabilities at verification time. This is dependency-advisory coverage, not a security audit.
- Tests use synthetic data with isolated temporary or in-memory databases.
- GitHub Actions repeats the build and tests. The branch/PR checks show the result for the exact published commit.

## Verification limits

- Browser visual/end-to-end checks remain incomplete: the managed preview returned a blank document. No browser workflow is claimed as passed.
- The local proxy test uses Node HTTP clients; hosted HTTPS/cookie behavior on Vercel + Render still needs the smoke checks in [DEPLOYMENT.md](DEPLOYMENT.md).
- No Render/Vercel service was provisioned or deployed during this preparation.
- Docker build/run was not tested; the deployment guide uses Render’s native Node runtime.
- External LLM, email delivery and payment integrations are not implemented or tested.

These results apply to this revision. They do not guarantee production suitability for confidential or business-critical data.
