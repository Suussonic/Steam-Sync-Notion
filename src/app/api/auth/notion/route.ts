import { type NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildNotionAuthUrl } from "@/lib/notion/oauth";
import { getSession } from "@/lib/session";

export async function GET(_request: NextRequest) {
  // Génère un state aléatoire anti-CSRF et le stocke en session
  const state = randomBytes(16).toString("hex");
  const session = await getSession();
  session.notionOAuthState = state;
  await session.save();

  return NextResponse.redirect(buildNotionAuthUrl(state));
}
