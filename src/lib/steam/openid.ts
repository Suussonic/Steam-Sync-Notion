/**
 * Steam OpenID 2.0 authentication helpers.
 *
 * Steam uses OpenID 2.0 (not OAuth), so we implement the flow manually:
 * 1. Build redirect URL → send user to Steam login page
 * 2. Steam sends user back with signed params → verify with Steam server
 * 3. Extract 64-bit Steam ID from the claimed_id
 */

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_ID_REGEX = /https:\/\/steamcommunity\.com\/openid\/id\/(\d+)/;

/** Builds the URL to redirect the user to Steam for login. */
export function buildSteamLoginUrl(appUrl: string): string {
  const returnTo = `${appUrl}/api/auth/steam/callback`;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": appUrl,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

/**
 * Verifies the OpenID callback from Steam.
 * Returns the 64-bit Steam ID string if valid, null otherwise.
 */
export async function verifySteamCallback(
  searchParams: URLSearchParams
): Promise<string | null> {
  // Re-send all params back to Steam with mode=check_authentication
  const verifyParams = new URLSearchParams(searchParams);
  verifyParams.set("openid.mode", "check_authentication");

  const response = await fetch(STEAM_OPENID_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });

  if (!response.ok) return null;

  const text = await response.text();
  if (!text.includes("is_valid:true")) return null;

  // Extract Steam ID from the claimed_id URL
  // Format: https://steamcommunity.com/openid/id/{steamId64}
  const claimedId = searchParams.get("openid.claimed_id") ?? "";
  const match = claimedId.match(STEAM_ID_REGEX);
  return match ? match[1] : null;
}

/** Fetches the Steam public profile for a given Steam ID. */
export async function getSteamProfile(steamId: string): Promise<SteamProfile | null> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`;
  const res = await fetch(url, { next: { revalidate: 300 } }); // cache 5 min
  if (!res.ok) return null;

  const data = await res.json();
  const player = data?.response?.players?.[0];
  return player ?? null;
}

export interface SteamProfile {
  steamid: string;
  personaname: string;
  avatarfull: string;
  profileurl: string;
  personastate: number;
}
