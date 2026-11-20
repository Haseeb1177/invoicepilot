# Deploy InvoicePilot: Vercel frontend + Render API

This guide deploys the existing portfolio MVP. The code has local build and integration checks; the final hosted checks below still need to run after your services exist.

## What you need

- GitHub access to `Haseeb1177/invoicepilot` and your Vercel/Render accounts.
- One **paid Render web service with a persistent disk** for this project. The included Blueprint selects `starter` and a 1 GB disk; review the displayed charge before creating it. Each project needs its own service and disk.
- An administrator email and a unique 16–256 character password. Enter them directly in Render; do not commit them or share them in chat.
- The exact HTTPS frontend and backend origins. Examples below are placeholders, not live deployment URLs.

No MongoDB cluster, LLM API key, email provider or payment gateway is needed for the implemented features. SQLite stores users, sessions and application records. Render’s free service has ephemeral storage and cannot use this persistent-disk design.

## 1. Choose the frontend origin

Use the stable production domain in your Vercel project’s Domains settings, for example `https://your-invoicepilot.vercel.app`. An existing project can keep its current domain. If you have not created the Vercel project yet, choose its project name and use the intended origin initially; confirm and correct it in Render once Vercel assigns the actual domain.

Keep the repository root as the project root, **not `web/`**. If the repository is already connected to automatic deployments, prepare the environment settings before merging these changes into its production branch. A build without `API_ORIGIN` intentionally fails.

## 2. Deploy the Render backend

Use **New → Blueprint**, connect this repository and select the branch containing `render.yaml`. Review the paid service and disk before applying. The Blueprint prompts for `APP_ORIGINS`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

Alternatively create a Node web service manually with these settings:

| Setting | Value |
| --- | --- |
| Root directory | Repository root (leave blank) |
| Runtime / Node | Node / `24` |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/api/health` |
| Persistent disk | Mount `/var/data`, size 1 GB |
| Instances | One |

| Render variable | Value |
| --- | --- |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `DB_PATH` | `/var/data/invoicepilot.sqlite` |
| `TRUST_PROXY_HOPS` | `1` |
| `APP_ORIGINS` | Your exact Vercel HTTPS origin, without a trailing slash |
| `ADMIN_EMAIL` | Your administrator email |
| `ADMIN_PASSWORD` | Your unique password, at least 16 characters |

Leave `PORT` to Render; the server reads it. The disk must exist before startup. The app checks that the database directory exists, but cannot verify your hosting plan or disk attachment: confirm the disk mount in Render.

Wait for the service to become healthy. Open its returned URL followed by `/api/health`; expect `{"ok":true}`. Keep the returned backend origin for Vercel. Changing bootstrap environment values does **not** reset an existing account: they are used only when the database has no users.

## 3. Deploy the Vercel frontend

Import the same GitHub repository, or open the existing Vercel project.

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Root directory | Repository root |
| Node version | 24.x |
| Install command | `npm ci --include=dev` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | `API_ORIGIN=https://your-backend.onrender.com` |

Set `API_ORIGIN` to the **actual** Render origin, with no trailing slash or `/api` suffix. Set it for Production. It is a server-side build setting; do not prefix it with `VITE_`. Keep `ADMIN_PASSWORD` in Render only.

`vercel.mjs` generates the `/api/*` proxy and SPA fallback at build time. The browser calls its own Vercel origin; Vercel forwards API requests to Render. The backend sets a host-only `__Host-session` cookie with `Secure`, `HttpOnly` and `SameSite=Strict`. No cross-origin browser API URL or permissive CORS setting is needed.

Deploy, confirm the actual Vercel domain, and update Render’s `APP_ORIGINS` if it differs from step 1. Changing `API_ORIGIN` requires a new Vercel deployment. A custom domain must also be explicitly listed in `APP_ORIGINS`.

## 4. Verify the hosted deployment

1. Open **the Vercel URL** followed by `/api/health`; expect JSON, not the frontend HTML page.
2. Sign in from the Vercel frontend using your Render bootstrap credentials. Refresh the page and confirm the session remains active.
3. Create a client and invoice, record a partial payment, download the PDF, then generate and approve an overdue reminder draft. No real email or payment is sent.
4. Restart the Render service and confirm the record still exists. This checks that the database is really on the mounted disk.
5. Sign out, refresh, and confirm the workspace requires sign-in again.

The local tests exercise proxy forwarding and cookie attributes using Node HTTP clients. They do not prove the hosted Vercel/Render TLS and browser-cookie flow; the checks above are still required.

## Operations and common errors

| Symptom | Check |
| --- | --- |
| Vercel build reports `API_ORIGIN` | Add the real HTTPS Render origin and redeploy; no slash/path suffix. |
| Login returns `Request origin is not allowed` | Match the browser’s exact origin in Render `APP_ORIGINS`, then restart/redeploy Render. |
| Login works but refresh signs out | Use the Vercel HTTPS URL and `/api` proxy; confirm cookie forwarding and that responses are not cached. |
| Render refuses to start | Read the startup error; check the disk mount, absolute `DB_PATH`, origin, email and password settings. |
| Production rejects a demo database | Start with a fresh production database path. Preserve any existing files before migration; do not delete data to bypass the check. |
| Credentials changed in settings but login unchanged | Bootstrap only creates the initial account. There is no password-reset UI yet. |
| API request returns frontend HTML | Keep repository root/output settings above and the included rewrite configuration. |

For multiple trusted domains, use comma-separated exact HTTPS origins. Do not allow arbitrary preview domains. Use a separate backend and disk for staging; configure Vercel Preview `API_ORIGIN` only for that backend.

Keep one API instance per SQLite database. Use a SQLite-aware backup operation and copy verified backups off the service; do not copy a live `.sqlite` file by itself while WAL writes are active. Test restoration before storing important data. A database migration is needed before multi-instance scaling. Login throttling is held in process memory and resets on restart.

The app has no self-service signup, password recovery or MFA. AgentGuard tools are simulated; InvoicePilot reminder sending and payment settlement remain manual. Docker is supplied as an alternative but was not built/run in this environment.

## Platform references

- [Render persistent disks](https://render.com/docs/disks)
- [Render Blueprint fields](https://render.com/docs/blueprint-spec)
- [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)
