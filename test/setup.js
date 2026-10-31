import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

beforeAll(async () => {
  if (env.DB && env.TEST_MIGRATIONS) {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  }
});
