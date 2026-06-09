# Steam Tracker Notion

Sync your Steam data (games library, achievements, inventory, profile) to a Notion workspace via OAuth.

## Roadmap

| Step | Status | Description |
|------|--------|-------------|
| 1 | ✅ | Project setup (Next.js 15 + TypeScript + Tailwind) |
| 2 | 🔜 | Steam authentication via OpenID |
| 3 | 🔜 | Notion OAuth integration |
| 4 | 🔜 | Sync game library → Notion database |
| 5 | 🔜 | Sync achievements per game → Notion |
| 6 | 🔜 | Sync inventory → Notion |
| 7 | 🔜 | Sync profile & friends → Notion |
| 8 | 🔜 | UI dashboard + scheduled sync |

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Auth**: Steam OpenID + Notion OAuth
- **Hosting**: Vercel

## Getting Started

1. Clone the repo
2. Copy `.env.example` to `.env.local` and fill in your API keys
3. `npm install`
4. `npm run dev`

## Environment Variables

See `.env.example` for a full list with descriptions.