import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  await session.destroy();
  return NextResponse.redirect(new URL("/", request.url));
}
