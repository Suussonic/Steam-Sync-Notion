import { type SessionOptions, getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { SteamProfile } from "@/lib/steam/openid";

export interface SessionData {
  // Steam
  steamId?: string;
  profile?: SteamProfile;
  isLoggedIn: boolean;
  // Notion OAuth
  notionToken?: string;
  notionWorkspaceId?: string;
  notionWorkspaceName?: string;
  notionWorkspaceIcon?: string | null;
  // Anti-CSRF pour le flow Notion
  notionOAuthState?: string;
  // Steam → Notion sync state
  notionSyncPageId?: string;
  notionSyncPageUrl?: string;
  notionLibraryDbId?: string;
  notionAchievementsDbId?: string;
  notionProfilePageId?: string;
  notionWishlistDbId?: string;
  notionFriendsDbId?: string;
  notionBadgesDbId?: string;
  notionInventoryDbId?: string;
  notionWorkshopDbId?: string;
  lastSyncAt?: string;
  lastSyncStats?: { games: number; achievements: number };
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "steam-sync-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
