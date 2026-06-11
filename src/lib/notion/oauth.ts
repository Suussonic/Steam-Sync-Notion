/**
 * Notion OAuth 2.0 helpers.
 *
 * Flow :
 * 1. buildNotionAuthUrl() → redirige l'utilisateur vers Notion
 * 2. Notion redirige vers /api/auth/notion/callback?code=...&state=...
 * 3. exchangeNotionCode() → échange le code contre un access_token
 */

const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

/** Construit l'URL d'autorisation Notion avec un state anti-CSRF. */
export function buildNotionAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID!,
    response_type: "code",
    owner: "user",
    redirect_uri: process.env.NOTION_REDIRECT_URI!,
    state,
  });
  return `${NOTION_AUTH_URL}?${params.toString()}`;
}

export interface NotionTokenResponse {
  access_token: string;
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  bot_id: string;
  owner: {
    type: string;
    user?: {
      id: string;
      name: string;
      avatar_url: string | null;
    };
  };
}

/**
 * Échange le code d'autorisation contre un access_token Notion.
 * Retourne null si l'échange échoue.
 */
export async function exchangeNotionCode(
  code: string
): Promise<NotionTokenResponse | null> {
  const credentials = Buffer.from(
    `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.NOTION_REDIRECT_URI,
    }),
  });

  if (!res.ok) return null;
  return res.json() as Promise<NotionTokenResponse>;
}
