import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET() {
  try {
    const authUser = await getAuthenticatedUser();
    return NextResponse.json({
      id: authUser.id,
      effectiveId: authUser.effectiveId,
      email: authUser.email,
      role: authUser.role,
      isImpersonating: authUser.isImpersonating,
      impersonatingEmail: authUser.impersonatingEmail || null,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
