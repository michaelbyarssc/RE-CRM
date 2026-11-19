import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { processDueSequences } from "@/lib/sequence-processor";
import { resolveAuthenticatedUser, runWithAuthUser } from "@/lib/auth";
import { withErrors } from "@/lib/api-handler";
import { UnauthorizedError } from "@/lib/errors";

// Two ways in, nothing else:
// - "Authorization: Bearer <CRON_SECRET>" processes the due steps of every
//   user. This path is off when CRON_SECRET is unset or shorter than 16
//   characters. Any other Authorization header is a 401, even when signed in.
// - No Authorization header: a signed-in user processes only their own due
//   steps (the sequences page calls this every 60 seconds).
// There is deliberately no GET: nothing runs this on a schedule.

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

function isCronSecret(header: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  // Equal-length digests, so the comparison takes the same time for any input.
  return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
}

export const POST = withErrors(async (req) => {
  const authorization = req.headers.get("authorization");
  if (authorization !== null) {
    if (!isCronSecret(authorization)) throw new UnauthorizedError();
    return NextResponse.json(await processDueSequences());
  }

  const user = await resolveAuthenticatedUser();
  return runWithAuthUser(user, async () =>
    NextResponse.json(await processDueSequences(user.effectiveId))
  );
});
