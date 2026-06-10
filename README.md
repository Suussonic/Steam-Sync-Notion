# Steam Sync Notion

Synchronise tes données Steam (bibliothèque de jeux, succès, inventaire, profil) vers un workspace Notion via OAuth.

## Stack technique

- **Framework** : Next.js 15 (App Router)
- **Langage** : TypeScript
- **Style** : Tailwind CSS v4
- **Auth** : Steam OpenID + Notion OAuth
- **Hébergement** : Vercel

## Démarrage

1. Cloner le dépôt
2. Copier `.env.example` en `.env.local` et remplir les valeurs
3. `npm install`
4. `npm run dev`

## Variables d'environnement

Copie `.env.example` en `.env.local` et remplis les valeurs. **Ne commite jamais `.env.local`** (il est dans `.gitignore`).

| Variable | Pourquoi c'est nécessaire |
|----------|--------------------------|
| `NEXT_PUBLIC_APP_URL` | URL de l'app (utilisée comme adresse de retour après le login Steam) |
| `STEAM_API_KEY` | Permet de récupérer les données Steam (jeux, profil, succès…). Obtenir sur [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) — domaine `localhost` pour le dev |
| `SESSION_SECRET` | Clé secrète qui **chiffre** le cookie de session. Sans ça, n'importe qui pourrait falsifier un cookie et se connecter en tant que toi. Génère-la avec : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NOTION_CLIENT_ID` | ID de ton intégration Notion (étape 3) |
| `NOTION_CLIENT_SECRET` | Secret de ton intégration Notion (étape 3) |
| `NOTION_REDIRECT_URI` | URL de callback après l'autorisation Notion (étape 3) |