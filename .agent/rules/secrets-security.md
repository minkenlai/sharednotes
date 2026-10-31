# Security Guardrails for SharedNotes

## 1. Confidentiality of Secrets & Keys
- **NEVER EXPOSE RAW SECRETS**: Do NOT print, display, or quote raw API keys, Cloudflare tokens, or `.env` secret values in conversation responses, task outputs, or markdown artifacts.
- **MASKING RULE**: Whenever referencing configured keys, mask them (e.g., show only first 6 characters followed by bullet masking: \`9c656b••••••••\`, or simply indicate \`[CONFIGURED]\`).
- **NO CAT OF SENSITIVE FILES**: Do not use shell tools to dump \`.env\` or secret files directly into terminal outputs. Check variables programmatically or verify existence using keys-masked utilities.

## 2. Git & Version Control Safeguards
- **IGNORE SECRETS**: Always verify that \`.env\`, \`.dev.vars\`, and \`.wrangler/\` remain in \`.gitignore\`.
- **NO COMMITTING DEPLOYMENT SECRETS**: Keep \`wrangler.toml\` in version control with template placeholders (\`REPLACE_WITH_D1_DATABASE_ID\`) when committing to public or shared branches.
- **KEY ROTATION**: When rotating keys, use the CLI's \`keys rotate\` command or automated pipes into \`npx wrangler secret put\` so secrets are transferred securely to Cloudflare without intermediate plaintext exposure.
