import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  session.notionToken = undefined;
  session.notionWorkspaceId = undefined;
  session.notionWorkspaceName = undefined;
  session.notionWorkspaceIcon = undefined;
  await session.save();
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
