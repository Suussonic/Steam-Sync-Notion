import { type NextRequest, NextResponse } from "next/server";
import { exchangeNotionCode } from "@/lib/notion/oauth";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // L'utilisateur a refusé l'autorisation
  if (error) {
    return NextResponse.redirect(new URL("/dashboard?error=notion_denied", request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/dashboard?error=notion_invalid", request.url));
  }

  // Vérification anti-CSRF : le state doit correspondre à celui stocké en session
  const session = await getSession();
  if (session.notionOAuthState !== state) {
    return NextResponse.redirect(new URL("/dashboard?error=notion_csrf", request.url));
  }

  // Échange du code contre un access_token
  const token = await exchangeNotionCode(code);
  if (!token) {
    return NextResponse.redirect(new URL("/dashboard?error=notion_token", request.url));
  }

  // Stocke les infos Notion dans la session et nettoie le state
  session.notionToken = token.access_token;
  session.notionWorkspaceId = token.workspace_id;
  session.notionWorkspaceName = token.workspace_name;
  session.notionWorkspaceIcon = token.workspace_icon;
  session.notionOAuthState = undefined;
  await session.save();

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
