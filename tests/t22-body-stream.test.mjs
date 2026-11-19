// T22. A request body with no declared length is refused as soon as it passes
// the size limit, without the server reading the rest
// (review finding F-BODY-CHUNKED).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { api, appUrl, sessionCookie, waitForApp } from "./helpers/http.mjs";
import { reseed, closeDb, USERS } from "./helpers/db.mjs";

const A = USERS.A;
const LIMIT = 10 * 1024 * 1024;

before(reseed);
after(closeDb);

/**
 * POST a chunked body (no Content-Length) of up to `maxBytes`, written in
 * 64 KB chunks, and stop writing as soon as the answer arrives.
 * Resolves { status, text, sentWhenAnswered }.
 */
function streamPost(path, { maxBytes, prefix = "", chunk = "a", headers = {} }) {
  const url = new URL(path, appUrl());
  return new Promise((resolve, reject) => {
    let sent = 0;
    let answered = false;
    const req = http.request(url, {
      method: "POST",
      headers: { cookie: sessionCookie(A), "content-type": "application/json", ...headers },
    });
    const timer = setTimeout(() => {
      req.destroy(new Error("no answer within 60 s"));
    }, 60_000);
    req.on("response", (res) => {
      answered = true;
      const sentWhenAnswered = sent;
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => {
        clearTimeout(timer);
        req.destroy();
        resolve({ status: res.statusCode, text: Buffer.concat(parts).toString("utf8"), sentWhenAnswered });
      });
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      if (!answered) reject(err);
    });
    const block = Buffer.from(chunk.repeat(64 * 1024 / chunk.length));
    const pump = () => {
      if (answered) return;
      if (sent === 0 && prefix) {
        req.write(prefix);
        sent += Buffer.byteLength(prefix);
      }
      while (!answered && sent < maxBytes) {
        sent += block.length;
        if (!req.write(block)) {
          req.once("drain", pump);
          return;
        }
      }
      if (!answered) req.end();
    };
    pump();
  });
}

test("T22 a chunked body far over the limit gets 413 before the server reads it all", async () => {
  const max = 200 * 1024 * 1024;
  let res;
  try {
    res = await streamPost("/api/tags", { maxBytes: max, prefix: '{"name":"' });
  } finally {
    await waitForApp();
  }
  assert.equal(res.status, 413, res.text.slice(0, 200));
  assert.equal(typeof JSON.parse(res.text).error, "string");
  // The answer must come long before the 200 MB are sent (socket buffers allow some slack).
  assert.ok(res.sentWhenAnswered < 4 * LIMIT, `answered after ${(res.sentWhenAnswered / 1048576).toFixed(1)} MB were sent`);
});

test("T22 a declared Content-Length over the limit is refused at once", async () => {
  const res = await new Promise((resolve, reject) => {
    const req = http.request(new URL("/api/tags", appUrl()), {
      method: "POST",
      headers: { cookie: sessionCookie(A), "content-type": "application/json", "content-length": String(LIMIT + 1) },
    });
    req.on("response", (r) => {
      r.resume();
      r.on("end", () => {
        req.destroy();
        resolve(r.statusCode);
      });
    });
    req.on("error", reject);
    req.flushHeaders();
  });
  assert.equal(res, 413);
});

test("T22 a small chunked body still works", async () => {
  const res = await streamPost("/api/tags", { maxBytes: 0, prefix: '{"name":"streamed tag","color":"#123456"}' });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.equal(JSON.parse(res.text).name, "streamed tag");
});

test("T22 an ordinary body works, an empty body reads as {}, malformed JSON is 400", async () => {
  const ok = await api("/api/tags", { method: "POST", user: A, body: { name: "plain tag", color: "#654321" } });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
  // POST /api/settings with {} stores nothing and answers ok.
  const empty = await api("/api/settings", { method: "POST", user: A, body: "" });
  assert.equal(empty.status, 200, empty.text.slice(0, 200));
  assert.deepEqual(empty.json, { ok: true });
  const bad = await api("/api/tags", { method: "POST", user: A, body: "{not json" });
  assert.equal(bad.status, 400);
});

test("T22 a body just under the limit is read in full (multi-byte characters counted as bytes)", async () => {
  // 3 bytes per character; a value just under the limit in bytes.
  const value = "€".repeat(Math.floor((LIMIT - 100) / 3));
  const under = await api("/api/settings", { method: "POST", user: A, body: { big: value }, timeoutMs: 60_000 });
  assert.equal(under.status, 200, under.text.slice(0, 200));
  const over = await api("/api/settings", { method: "POST", user: A, body: { big: value + "€".repeat(100) }, timeoutMs: 60_000 });
  assert.equal(over.status, 413, over.text.slice(0, 200));
});
