### Generate Production API Keys

Generate a strong random key:

# Generate your key
openssl rand -hex 24

──────
### Replace Secrets in Cloudflare Workers

Run npx wrangler secret put to overwrite the secrets with your production keys, names, and roles:

1. Upload your keys:
npx wrangler secret put API_KEYS
# Enter: <your-key>,<partner-key>

2. Upload matching names (in the exact same order):
npx wrangler secret put KEY_OWNERS
# Enter: <your-username>,<partner-username>

3. Upload matching roles (admin or user):
npx wrangler secret put KEY_ROLES
# Enter: admin,user (or admin,admin if both should be admins)


(Cloudflare will automatically re-deploy the Worker with the new secrets).
──────
### Update Your Local .env

Edit .env so the CLI tool uses your real key:

WORKER_URL=https://sharednotes.<your-subdomain>.workers.dev
API_KEY=<your-key>

Verify your setup with the CLI:

./bin/cli.js whoami
./bin/cli.js health
──────
### Deliver Credentials to Your Partner

Provide your partner with:

1. Service URL: https://sharednotes.<your-subdomain>.workers.dev
2. Their personal API key (never your key, so created_by attribution remains distinct)
3. Headers for API / Muse connector:
  • Authorization: Bearer <partner-key> (or X-API-Key: <partner-key>)

