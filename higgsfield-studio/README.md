# Higgsfield Studio

Generate images and video with Higgsfield models (Seedance, Kling, Soul, Flux, Wan and more) through one Studio UI.

## Setup

```bash
cd higgsfield-studio
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Click **Connect API key** in the sidebar.
2. Paste the complete key copied from [open.higgsfield.ai/api-keys](https://open.higgsfield.ai/api-keys) as-is.
3. Pick an image or video model, enter a prompt, Generate.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `HF_API_BASE_URL` | Yes (defaults in `.env.local`) | Must be `https://api.higgsfield.ai` |
| `HF_API_KEY` | No | Optional shared server key; default is per-browser Connect API key |

Authenticated platform calls stay on the server. The key is stored in an HTTP-only cookie and never returned to the client.

## Scripts

- `pnpm dev` — local Studio
- `pnpm typecheck` — TypeScript
- `pnpm build` — production build (also regenerates the model barrel)
- `pnpm dlx shadcn@latest list higgsfield-ai/app-templates` — discover models
- `pnpm dlx shadcn@latest add higgsfield-ai/app-templates/<model>` — add a model

## Docs notes

- Platform docs: [docs.higgsfield.ai/docs/llms.txt](https://docs.higgsfield.ai/docs/llms.txt)
- Model discovery: [open.higgsfield.ai/explore](https://open.higgsfield.ai/explore)
- Auth header scheme used by this app: `Authorization: Key <complete-copied-key>`
- Some docs pages still show `Key <id>:<secret>`; the Connect API key flow pastes the complete copied credential in one field without requiring a colon in the UI.
