import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index.js";

function makeReq(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.auth) {
    headers.set("Authorization", `Bearer ${options.auth}`);
  }
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  return new Request(`https://sharednotes.local${path}`, {
    method: options.method || "GET",
    headers,
    body,
  });
}

async function dispatch(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("In-Runtime Worker Tests with Miniflare D1", () => {
  it("GET /health returns 200 and ok: true with security headers", async () => {
    const res = await dispatch(makeReq("/health"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.service).toBe("sharednotes");

    // Verify defensive security headers
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("GET /instructions returns public docs, plus admin section if admin key", async () => {
    const publicRes = await dispatch(makeReq("/instructions"));
    expect(publicRes.status).toBe(200);
    const publicText = await publicRes.text();
    expect(publicText).toContain("SharedNotes Service");
    expect(publicText).not.toContain("Admin Operations (Privileged Mode)");

    const adminRes = await dispatch(makeReq("/instructions", { auth: "test-admin-key" }));
    expect(adminRes.status).toBe(200);
    const adminText = await adminRes.text();
    expect(adminText).toContain("Admin Operations (Privileged Mode)");
  });

  it("GET /notes returns 401 without auth", async () => {
    const res = await dispatch(makeReq("/notes"));
    expect(res.status).toBe(401);
  });

  it("CRUD lifecycle on in-memory D1 database", async () => {
    // 1. Create a note as regular user
    const createRes = await dispatch(
      makeReq("/notes", {
        method: "POST",
        auth: "test-user-key",
        body: {
          title: "Unit Test Note",
          body: "Testing with vitest and miniflare",
          snippet: "Unit test snippet",
          content_type: "text/plain",
        },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeDefined();
    expect(created.created_by).toBe("regular_user");
    expect(created.snippet).toBe("Unit test snippet");

    const noteId = created.id;

    // 2. Read the note
    const getRes = await dispatch(
      makeReq(`/notes/${noteId}`, { auth: "test-user-key" }),
    );
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.title).toBe("Unit Test Note");

    // 3. Update the note
    const updateRes = await dispatch(
      makeReq(`/notes/${noteId}`, {
        method: "PUT",
        auth: "test-user-key",
        body: { title: "Updated Unit Test Note" },
      }),
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.title).toBe("Updated Unit Test Note");

    // 4. Archive note
    const archiveRes = await dispatch(
      makeReq(`/notes/${noteId}/archive`, {
        method: "POST",
        auth: "test-user-key",
      }),
    );
    expect(archiveRes.status).toBe(200);
    const archived = await archiveRes.json();
    expect(archived.is_archived).toBe(1);

    // 5. Delete (soft-delete) note
    const deleteRes = await dispatch(
      makeReq(`/notes/${noteId}`, {
        method: "DELETE",
        auth: "test-user-key",
      }),
    );
    expect(deleteRes.status).toBe(204);

    // 6. Regular user cannot see soft-deleted note
    const getDeletedUserRes = await dispatch(
      makeReq(`/notes/${noteId}`, { auth: "test-user-key" }),
    );
    expect(getDeletedUserRes.status).toBe(404);

    // 7. Admin can restore soft-deleted note
    const restoreRes = await dispatch(
      makeReq(`/notes/${noteId}/restore`, {
        method: "POST",
        auth: "test-admin-key",
      }),
    );
    expect(restoreRes.status).toBe(200);
    const restored = await restoreRes.json();
    expect(restored.is_deleted).toBe(0);
  });
});
