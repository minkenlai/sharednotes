// Shared notes service: tiny REST CRUD behind API-key auth.
// Runs on Cloudflare Workers with a D1 (SQLite) binding named DB.
//
// Auth: send one of these headers with a key from the API_KEYS secret:
//   Authorization: Bearer <key>
//   X-API-Key: <key>
//   Authorization: Basic base64(<anything>:<key>)   (curl convenience only)
// The key's owner (from KEY_OWNERS, same order as API_KEYS) is stored
// as created_by, so readers can tell whose agent wrote a note.
//
// Roles:
//   KEY_ROLES secret: comma-separated list of roles matching API_KEYS ("admin" or "user").
//   ADMIN_USERS secret: optional comma-separated list of owner names that have "admin" role.
//   Defaults to "user" if unspecified.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

function splitList(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function computeSnippet(customSnippet, body) {
  if (typeof customSnippet === "string" && customSnippet.trim().length > 0) {
    return customSnippet.trim();
  }
  if (typeof body === "string") {
    return body.slice(0, 150);
  }
  return "";
}

// Returns { owner, role } or null when unauthorized.
function authenticate(request, env) {
  const valid = splitList(env.API_KEYS);
  if (valid.length === 0) return null;
  const header = request.headers.get("Authorization") || "";
  const headerKey = request.headers.get("X-API-Key") || "";
  let presented = "";
  if (header.startsWith("Bearer ")) {
    presented = header.slice(7).trim();
  } else if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6).trim());
      const colon = decoded.indexOf(":");
      presented = colon === -1 ? decoded : decoded.slice(colon + 1);
    } catch {
      presented = "";
    }
  }
  if (!presented && headerKey) presented = headerKey.trim();
  const idx = valid.indexOf(presented);
  if (idx === -1) return null;

  const owner = splitList(env.KEY_OWNERS)[idx] || "unknown";
  const explicitRole = (splitList(env.KEY_ROLES)[idx] || "").toLowerCase();
  const adminUsers = splitList(env.ADMIN_USERS).map((u) => u.toLowerCase());
  const isAdmin = explicitRole === "admin" || adminUsers.includes(owner.toLowerCase());
  const role = isAdmin ? "admin" : "user";

  return { owner, role };
}

async function readBody(request) {
  try {
    const data = await request.json();
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean);

      if (parts.length === 1 && parts[0] === "health") {
        return json({ ok: true, service: "sharednotes" });
      }

      if (parts[0] !== "notes") {
        return json({ error: "not_found" }, 404);
      }

      const auth = authenticate(request, env);
      if (auth === null) {
        return json({ error: "unauthorized" }, 401);
      }
      const { owner, role } = auth;

      // GET /notes
      if (parts.length === 1 && request.method === "GET") {
        const rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
        const limit = Number.isNaN(rawLimit)
          ? 50
          : Math.min(200, Math.max(1, rawLimit));

        const statusParam = (url.searchParams.get("status") || "").toLowerCase();
        const archivedParam = url.searchParams.get("archived");
        const deletedParam = url.searchParams.get("deleted");
        const sinceParam = url.searchParams.get("since");
        const qParam = (url.searchParams.get("q") || "").trim();
        const full = url.searchParams.get("full") === "true";

        let isDeletedFilter;
        let isArchivedFilter;

        if (statusParam === "deleted" || deletedParam === "true") {
          if (role !== "admin") {
            return json(
              { error: "forbidden", message: "Only admins can view deleted notes" },
              403,
            );
          }
          isDeletedFilter = 1;
        } else if (deletedParam === "false") {
          isDeletedFilter = 0;
        }

        if (statusParam === "archived" || archivedParam === "true") {
          isArchivedFilter = 1;
        } else if (archivedParam === "false") {
          isArchivedFilter = 0;
        }

        if (statusParam === "all") {
          if (role !== "admin") {
            isDeletedFilter = 0;
          }
        } else if (statusParam === "active") {
          isDeletedFilter = 0;
          isArchivedFilter = 0;
        } else if (isDeletedFilter === undefined && isArchivedFilter === undefined) {
          isDeletedFilter = 0;
          isArchivedFilter = 0;
        } else if (isDeletedFilter === undefined) {
          isDeletedFilter = 0;
        }

        const conditions = [];
        const bindings = [];

        if (isDeletedFilter !== undefined) {
          conditions.push("is_deleted = ?");
          bindings.push(isDeletedFilter);
        }
        if (isArchivedFilter !== undefined) {
          conditions.push("is_archived = ?");
          bindings.push(isArchivedFilter);
        }

        if (sinceParam) {
          conditions.push("updated_at > ?");
          bindings.push(sinceParam);
        }

        if (qParam) {
          conditions.push("(title LIKE ? OR snippet LIKE ? OR body LIKE ?)");
          const likePattern = `%${qParam}%`;
          bindings.push(likePattern, likePattern, likePattern);
        }

        const selectCols = full
          ? "id, title, COALESCE(NULLIF(snippet, ''), SUBSTR(body, 1, 150)) AS snippet, body, created_by, is_archived, is_deleted, created_at, updated_at"
          : "id, title, COALESCE(NULLIF(snippet, ''), SUBSTR(body, 1, 150)) AS snippet, created_by, is_archived, is_deleted, created_at, updated_at";

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const sql = `SELECT ${selectCols} FROM notes ${whereClause} ORDER BY updated_at DESC LIMIT ?`;
        bindings.push(limit);

        const rows = await env.DB.prepare(sql).bind(...bindings).all();
        return json({ notes: rows.results });
      }

      // POST /notes
      if (parts.length === 1 && request.method === "POST") {
        const body = await readBody(request);
        if (body === null) return json({ error: "invalid_json" }, 400);
        const now = new Date().toISOString();
        const bodyText = typeof body.body === "string" ? body.body : "";
        const snippet = computeSnippet(body.snippet, bodyText);

        const note = {
          id: crypto.randomUUID(),
          title: typeof body.title === "string" ? body.title : "",
          snippet,
          body: bodyText,
          created_by: owner,
          is_archived: body.is_archived || body.archived ? 1 : 0,
          is_deleted: 0,
          created_at: now,
          updated_at: now,
        };
        await env.DB.prepare(
          "INSERT INTO notes (id, title, snippet, body, created_by, is_archived, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
          .bind(
            note.id,
            note.title,
            note.snippet,
            note.body,
            note.created_by,
            note.is_archived,
            note.is_deleted,
            note.created_at,
            note.updated_at,
          )
          .run();
        return json(note, 201);
      }

      // /notes/:id routes
      if (parts.length === 2) {
        const id = decodeURIComponent(parts[1]);
        const existing = await env.DB.prepare(
          "SELECT * FROM notes WHERE id = ?",
        )
          .bind(id)
          .first();

        if (request.method === "GET") {
          if (!existing) return json({ error: "not_found" }, 404);
          if (existing.is_deleted === 1 && role !== "admin") {
            return json({ error: "not_found" }, 404);
          }
          const note = {
            ...existing,
            snippet: existing.snippet || computeSnippet(undefined, existing.body),
          };
          return json(note);
        }

        if (request.method === "PUT") {
          if (!existing) return json({ error: "not_found" }, 404);
          if (existing.is_deleted === 1 && role !== "admin") {
            return json({ error: "not_found" }, 404);
          }
          const body = await readBody(request);
          if (body === null) return json({ error: "invalid_json" }, 400);

          let isArchived = existing.is_archived;
          if (typeof body.is_archived === "boolean" || typeof body.is_archived === "number") {
            isArchived = body.is_archived ? 1 : 0;
          } else if (typeof body.archived === "boolean" || typeof body.archived === "number") {
            isArchived = body.archived ? 1 : 0;
          }

          const newBody = typeof body.body === "string" ? body.body : existing.body;
          let newSnippet;
          if (typeof body.snippet === "string") {
            newSnippet = body.snippet.trim();
          } else if (typeof body.body === "string") {
            newSnippet = computeSnippet(undefined, newBody);
          } else {
            newSnippet = existing.snippet || computeSnippet(undefined, existing.body);
          }

          const updated = {
            ...existing,
            title: typeof body.title === "string" ? body.title : existing.title,
            snippet: newSnippet,
            body: newBody,
            is_archived: isArchived,
            updated_at: new Date().toISOString(),
          };
          await env.DB.prepare(
            "UPDATE notes SET title = ?, snippet = ?, body = ?, is_archived = ?, updated_at = ? WHERE id = ?",
          )
            .bind(
              updated.title,
              updated.snippet,
              updated.body,
              updated.is_archived,
              updated.updated_at,
              id,
            )
            .run();
          return json(updated);
        }

        if (request.method === "DELETE") {
          if (!existing) return json({ error: "not_found" }, 404);
          if (existing.is_deleted === 1 && role !== "admin") {
            return json({ error: "not_found" }, 404);
          }

          // Optional permanent hard delete for admins
          if (url.searchParams.get("permanent") === "true") {
            if (role !== "admin") {
              return json(
                { error: "forbidden", message: "Only admins can permanently delete notes" },
                403,
              );
            }
            await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
            return new Response(null, { status: 204 });
          }

          // Standard soft delete
          await env.DB.prepare(
            "UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?",
          )
            .bind(new Date().toISOString(), id)
            .run();
          return new Response(null, { status: 204 });
        }

        return json({ error: "method_not_allowed" }, 405);
      }

      // /notes/:id/:action routes (archive, unarchive, restore)
      if (parts.length === 3) {
        const id = decodeURIComponent(parts[1]);
        const action = parts[2].toLowerCase();

        if (request.method !== "POST") {
          return json({ error: "method_not_allowed" }, 405);
        }

        const existing = await env.DB.prepare(
          "SELECT * FROM notes WHERE id = ?",
        )
          .bind(id)
          .first();

        if (!existing) return json({ error: "not_found" }, 404);

        if (action === "restore") {
          if (role !== "admin") {
            return json(
              { error: "forbidden", message: "Only admins can restore deleted notes" },
              403,
            );
          }
          const now = new Date().toISOString();
          await env.DB.prepare(
            "UPDATE notes SET is_deleted = 0, updated_at = ? WHERE id = ?",
          )
            .bind(now, id)
            .run();
          return json({
            ...existing,
            snippet: existing.snippet || computeSnippet(undefined, existing.body),
            is_deleted: 0,
            updated_at: now,
          });
        }

        // Only admins can interact with a note that is deleted
        if (existing.is_deleted === 1 && role !== "admin") {
          return json({ error: "not_found" }, 404);
        }

        if (action === "archive") {
          const now = new Date().toISOString();
          await env.DB.prepare(
            "UPDATE notes SET is_archived = 1, updated_at = ? WHERE id = ?",
          )
            .bind(now, id)
            .run();
          return json({
            ...existing,
            snippet: existing.snippet || computeSnippet(undefined, existing.body),
            is_archived: 1,
            updated_at: now,
          });
        }

        if (action === "unarchive") {
          const now = new Date().toISOString();
          await env.DB.prepare(
            "UPDATE notes SET is_archived = 0, updated_at = ? WHERE id = ?",
          )
            .bind(now, id)
            .run();
          return json({
            ...existing,
            snippet: existing.snippet || computeSnippet(undefined, existing.body),
            is_archived: 0,
            updated_at: now,
          });
        }

        return json({ error: "not_found" }, 404);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      return json({ error: "internal", detail: String(err) }, 500);
    }
  },
};
