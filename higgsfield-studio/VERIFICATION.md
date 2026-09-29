# Verification notes

## Verified in this environment

- Scaffold: `higgsfield-ai/app-templates/studio` with full bundled catalog (38 model entries: 8 image, 30 video).
- `HF_API_BASE_URL=https://api.higgsfield.ai` in `.env.local` / `.env.example`.
- Connect API key dialog title **Connect API key**; body includes **Paste the API key copied from open.higgsfield.ai** and **Paste it as-is.**; single `password` field; no key/secret split in UI.
- Server auth header helper emits `Authorization: Key <complete-copied-key>` (colon allowed inside the pasted value if the platform includes one).
- `pnpm build` and `pnpm typecheck` pass.
- UI (Playwright): key dialog opens; Explore templates fill the dock; video picker lists 30 models; image picker lists 8 models.

## Documentation conflicts / unverified

- [Authentication docs](https://docs.higgsfield.ai/docs/authentication.md) still describe `Key YOUR_KEY_ID:YOUR_KEY_SECRET` with separate env vars. The Studio Connect flow and this app follow the product brief: paste the **complete** credential as copied from [open.higgsfield.ai/api-keys](https://open.higgsfield.ai/api-keys).
- Model endpoint mappings come from the official Studio catalog files. Individual model `llms.txt` / OpenAPI contracts were not live-tested against an account API key in this environment.
- No live generation, cancel, webhook, or signed upload was exercised (no user API key provided). Account access for specific models is therefore **not** verified.
- Explore page (`open.higgsfield.ai/explore`) lists additional models (e.g. Marketing Studio Image, Cinema Studio 4.0, Genjutsu) that are **not** in the current Studio template catalog files; those were not invented or added.

## How to try

```bash
cd higgsfield-studio
pnpm install
pnpm dev
```

Open http://localhost:3000 → **Connect API key** → paste key from open.higgsfield.ai → Generate.
