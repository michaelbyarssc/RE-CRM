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

function className(e: unknown): string {
  if (!e || typeof e !== "object") return typeof e;
  const ctor = (e as { constructor?: { name?: unknown } }).constructor?.name;
  const name = (e as { name?: unknown }).name;
  return [ctor, name].filter((v, i, a) => typeof v === "string" && v && a.indexOf(v) === i).join("/") || "Object";
}

/**
 * A log line that is safe to keep: method and path, the error class, and for
 * a database error its Postgres code, constraint, table and the stack frames
 * of the driver error. Never an error message: Drizzle's message carries the
 * query and its parameters (API keys, personal data), and a Postgres message
 * or `detail` can quote the values too.
 */
function safeErrorSummary(err: unknown, req?: Request): string {
  let where = "unknown request";
  if (req) {
    let pathname = "?";
    try {
      pathname = new URL(req.url).pathname;
    } catch {
      // keep "?"
    }
    where = `${req.method} ${pathname}`;
  }
  const lines = [`API route error: ${where} class=${className(err)}`];
  // The driver error is the first one in the cause chain that has a code.
  let driver: Record<string, unknown> | undefined;
  for (let e = err as Record<string, unknown> | undefined, i = 0; e && typeof e === "object" && i < 3; e = e.cause as typeof e, i++) {
    if (typeof e.code === "string") {
      driver = e;
      break;
    }
  }
  if (driver) {
    const fields = [`driver=${className(driver)}`, `code=${driver.code}`];
    if (typeof driver.constraint_name === "string") fields.push(`constraint=${driver.constraint_name}`);
    if (typeof driver.table_name === "string") fields.push(`table=${driver.table_name}`);
    lines.push(`  ${fields.join(" ")}`);
  }
  const stackOf = driver ?? err;
  const stack = stackOf && typeof stackOf === "object" ? (stackOf as { stack?: unknown }).stack : undefined;
  if (typeof stack === "string") {
    // Stack frames only: the first line of a stack repeats the message.
    lines.push(...stack.split("\n").filter((l) => /^\s+at /.test(l)));
  }
  return lines.join("\n");
}

export function errorResponse(err: unknown, req?: Request): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (pgErrorCode(err) === "23505") {
    return NextResponse.json({ error: "Already exists" }, { status: 409 });
  }
  console.error(safeErrorSummary(err, req));
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Error mapping only. For the one route that has its own way to authenticate. */
export function withErrors(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err, req);
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
