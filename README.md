# Shared notes service

A tiny REST service for shared notes between two people (and their Muses).
Runs on Cloudflare Workers + D1 (SQLite). Auth is an API key per person,
sent as a `Bearer` token or `X-API-Key` header.

## Roles & Permissions

- **`user` (default)**: Can create, view, update, soft-delete, archive, and unarchive notes.
- **`admin`**: In addition to user capabilities, admins can view soft-deleted notes, restore soft-deleted notes, and permanently delete notes (`?permanent=true`).

Role assignment is managed via secrets:
- `KEY_ROLES`: comma-separated roles parallel to `API_KEYS` (e.g. `admin,user`).
- `ADMIN_USERS` (optional): comma-separated owner names with admin privileges (e.g. `alice`).

## API

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/health` | Public | Returns `{"ok":true,"service":"sharednotes"}`. |
| GET | `/notes` | User / Admin | List notes, newest first. Supported query params below. |
| GET | `/notes/:id` | User / Admin | Get one note. Returns 404 for deleted notes if not admin. |
| POST | `/notes` | User / Admin | JSON `{"title": "...", "body": "...", "archived": false}`. Returns note with id, 201. |
| PUT | `/notes/:id` | User / Admin | JSON with `title`, `body`, and/or `archived` boolean. Returns updated note. |
| DELETE | `/notes/:id` | User / Admin | Soft deletes note (`is_deleted = 1`). Returns 204. |
| DELETE | `/notes/:id?permanent=true` | Admin only | Permanently removes note from database. Returns 204. |
| POST | `/notes/:id/archive` | User / Admin | Marks note as archived (`is_archived = 1`). |
| POST | `/notes/:id/unarchive` | User / Admin | Unarchives note (`is_archived = 0`). |
| POST | `/notes/:id/restore` | Admin only | Restores deleted note (`is_deleted = 0`). Returns 403 for regular users. |

### Query Parameters for `GET /notes`

- `?q=<query>`: Search keyword across titles, snippets, and bodies.
- `?since=<timestamp>`: Delta sync filter. Returns only notes updated after the given ISO-8601 timestamp (e.g. `?since=2026-10-30T15:00:00Z`).
- `?full=true`: Includes full `body` in list response. (By default, `body` is omitted to preserve context tokens; only `snippet` preview is returned).
- `?limit=50`: Number of notes to return (default 50, min 1, max 200).
- `?status=active|archived|deleted|all`:
  - `active` (default): Only active, non-archived, non-deleted notes (`is_deleted = 0 AND is_archived = 0`).
  - `archived`: Only archived notes (`is_deleted = 0 AND is_archived = 1`).
  - `deleted`: Only soft-deleted notes (`is_deleted = 1`). **Admin only** (returns 403 for regular users).
  - `all`: All non-deleted notes for users, or all notes including deleted for admins.
- Explicit boolean flags:
  - `?archived=true`: Filter for archived notes.
  - `?deleted=true`: Filter for deleted notes (**Admin only**).

Every note records `title`, `snippet` (first 150ch of body by default, or custom blurb), `body`, `created_by`, `is_archived`, `is_deleted`, `created_at`, and `updated_at`.

## Local Development & Testing

To develop and test without touching production secrets or the remote database:

```sh
# 1. Initialize/apply migrations to local SQLite database
npm run migrate:local

# 2. Start local dev server (reads secrets from .dev.vars)
npm run dev
# Server ready on http://localhost:8787

# 3. In another terminal, run tests locally against http://localhost:8787
npm run test:local

# 4. Use CLI tool locally
npm run cli -- health --url=http://localhost:8787 --key=dev-key-admin
npm run cli -- ls --url=http://localhost:8787 --key=dev-key-admin
```

## Deploy (Cloudflare free tier)

```sh
cd ~/workspace/sharednotes-service
npx wrangler login
npx wrangler d1 create sharednotes
```

Copy the `database_id` from that output into `wrangler.toml`, then:

```sh
npx wrangler d1 migrations apply sharednotes --remote
npx wrangler secret put API_KEYS
# enter comma-separated keys, e.g. key-for-alice,key-for-bob
npx wrangler secret put KEY_OWNERS
# enter matching names in the same order, e.g. alice,bob
npx wrangler secret put KEY_ROLES
# enter matching roles in the same order, e.g. admin,user
npx wrangler deploy
```

Deploy prints the URL, like `https://sharednotes.<subdomain>.workers.dev`.

## CLI Tool

A standalone CLI tool is included in `bin/cli.js` (and available as `npm run cli -- <args>` or directly `./bin/cli.js`). It reads configuration directly from `.env` (`WORKER_URL`, `API_KEY`, `TEST_ADMIN_KEY`, `TEST_USER_KEY`).

```sh
# Health and auth check
npm run cli -- health
npm run cli -- whoami

# List notes
npm run cli -- ls
npm run cli -- ls --status=archived
npm run cli -- ls --status=deleted --as=admin

# Create, read, and edit
npm run cli -- create -t "Todo" -b "Buy milk"
npm run cli -- get <id>
npm run cli -- edit <id> -t "New Title" -b "New Body"

# Archive and unarchive
npm run cli -- archive <id>
npm run cli -- unarchive <id>

# Delete and restore
npm run cli -- rm <id>                          # Soft delete
npm run cli -- rm <id> --permanent --as=admin   # Hard delete (admin)
npm run cli -- restore <id> --as=admin          # Restore deleted note (admin)
```

## Test

```sh
curl https://sharednotes.<subdomain>.workers.dev/health

# List active notes
curl -H "Authorization: Bearer <your-key>" \
  https://sharednotes.<subdomain>.workers.dev/notes

# Create a note
curl -X POST -H "Authorization: Bearer <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","body":"First shared note"}' \
  https://sharednotes.<subdomain>.workers.dev/notes

# Archive note
curl -X POST -H "Authorization: Bearer <your-key>" \
  https://sharednotes.<subdomain>.workers.dev/notes/<id>/archive

# View archived notes
curl -H "Authorization: Bearer <your-key>" \
  https://sharednotes.<subdomain>.workers.dev/notes?status=archived

# Soft delete note
curl -X DELETE -H "Authorization: Bearer <your-key>" \
  https://sharednotes.<subdomain>.workers.dev/notes/<id>

# View deleted notes (Admin key required)
curl -H "Authorization: Bearer <admin-key>" \
  https://sharednotes.<subdomain>.workers.dev/notes?status=deleted

# Restore deleted note (Admin key required)
curl -X POST -H "Authorization: Bearer <admin-key>" \
  https://sharednotes.<subdomain>.workers.dev/notes/<id>/restore
```

## After deploy

Tell Muse the deployed URL. That unblocks the last step: registering the
custom connector credential for this host and verifying a real read, so both
Muses get a proper tool for the service instead of raw HTTP calls. Give
Bob her own key (never yours) and the connector files from
`~/workspace/custom-connectors/custom.sharednotes/` for her Muse.
