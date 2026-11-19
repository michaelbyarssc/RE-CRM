import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { resolveAuthenticatedUser, runWithAuthUser, type AuthUser } from "@/lib/auth";
import { BadRequestError, ForbiddenError, HttpError } from "@/lib/errors";

// One front door for every route in app/api.
//
// withAuth() authenticates before any handler code runs (and before the body
// is read), answers a signed-out caller with 401, and makes the signed-in user
// available to getAuthenticatedUser() for the rest of the request, so one
// request makes one auth round trip.
//
// Errors become plain JSON answers: HttpError keeps its status and fixed
// message, a validation failure is 400, a duplicate row is 409, anything else
// is a generic 500 that is logged on the server. No answer ever contains a
// stack trace or raw error text.

type HandlerContext = { params: Promise<Record<string, string | string[] | undefined>> };
type Handler = (req: NextRequest, ctx: HandlerContext) => Promise<Response>;

export interface AuthedArgs<P> {
  req: NextRequest;
  user: AuthUser;
  params: P;
}

function pgErrorCode(err: unknown): string | undefined {
  // Drizzle wraps the driver error; the Postgres code sits on it or on its cause.
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 3; e = e.cause as typeof e, i++) {
    if (typeof e.code === "string") return e.code;
  }
  return undefined;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (pgErrorCode(err) === "23505") {
    return NextResponse.json({ error: "Already exists" }, { status: 409 });
  }
  console.error("API route error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Error mapping only. For the one route that has its own way to authenticate. */
export function withErrors(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Authenticate first, then run the handler. `admin: true` answers 403 to non-admins. */
export function withAuth<P extends Record<string, string> = Record<string, string>>(
  handler: (args: AuthedArgs<P>) => Promise<Response>,
  options: { admin?: boolean } = {}
): Handler {
  return withErrors(async (req, ctx) => {
    const user = await resolveAuthenticatedUser();
    if (options.admin && user.role !== "admin") throw new ForbiddenError();
    const params = (ctx?.params ? await ctx.params : {}) as P;
    return runWithAuthUser(user, () => handler({ req, user, params }));
  });
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Read the body as a stream and count bytes, so a body without a declared
 * length (chunked) is refused as soon as it passes the limit, without
 * buffering the rest.
 */
async function readBodyText(req: NextRequest, limit: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }
  // Decoded as req.text() does (UTF-8, a leading BOM dropped).
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Read a JSON body. Malformed JSON is a 400; an empty body reads as {}. */
export async function readJson(req: NextRequest): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
  const text = await readBodyText(req, MAX_BODY_BYTES);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError("Malformed JSON body");
  }
}

/** Read a JSON body that must be an object (not an array, string or number). */
export async function readJsonObject(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("Expected a JSON object");
  }
  return body as Record<string, unknown>;
}
