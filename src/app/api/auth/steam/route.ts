import { redirect } from "next/navigation";
import { buildSteamLoginUrl } from "@/lib/steam/openid";

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  redirect(buildSteamLoginUrl(appUrl));
}
