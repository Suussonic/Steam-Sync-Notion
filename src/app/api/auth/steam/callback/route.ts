import { type NextRequest, NextResponse } from "next/server";
import { verifySteamCallback, getSteamProfile } from "@/lib/steam/openid";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Verify the OpenID assertion with Steam
  const steamId = await verifySteamCallback(searchParams);

  if (!steamId) {
    return NextResponse.redirect(new URL("/?error=auth_failed", request.url));
  }

  // Fetch Steam profile to store in session
  const profile = await getSteamProfile(steamId);

  // Persist in encrypted session cookie
  const session = await getSession();
  session.isLoggedIn = true;
  session.steamId = steamId;
  if (profile) session.profile = profile;
  await session.save();

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
