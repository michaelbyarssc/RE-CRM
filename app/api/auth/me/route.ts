import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-handler";

export const GET = withAuth(async ({ user }) => {
  return NextResponse.json({
    id: user.id,
    effectiveId: user.effectiveId,
    email: user.email,
    role: user.role,
    isImpersonating: user.isImpersonating,
    impersonatingEmail: user.impersonatingEmail || null,
  });
});
