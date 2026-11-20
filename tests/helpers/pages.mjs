// The app's page routes, and the real address the tests open for each.
//
// The routes come from the build (.next/app-path-routes-manifest.json in
// this Next.js version), not from a hand count. Every page route of the
// build must have an entry in PAGE_ADDRESS below, and every entry must be a
// page route of the build. So a new page that nobody listed here fails the
// tests that use this list (t31 over HTTP, t33 in the browser).

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * For each page route, the real address to open. A route with an id maps
 * to one real row from the seed data (`ids` is what reseed() returns).
 */
const PAGE_ADDRESS = {
  "/": () => "/",
  "/buyers": () => "/buyers",
  "/calendar": () => "/calendar",
  "/dialer": () => "/dialer",
  "/knowledge-base": () => "/knowledge-base",
  "/leads": () => "/leads",
  "/leads/[id]": (ids) => `/leads/${ids.aLead}`,
  "/leads/import": () => "/leads/import",
  "/login": () => "/login",
  "/map": () => "/map",
  "/pipeline": () => "/pipeline",
  "/privacy": () => "/privacy",
  "/sequences": () => "/sequences",
  "/sequences/[id]": (ids) => `/sequences/${ids.aSeq}`,
  "/settings": () => "/settings",
  "/skip-trace": () => "/skip-trace",
  "/terms": () => "/terms",
  "/welcome": () => "/welcome",
};

/** The pages a signed-out visitor may read (the same list as publicPaths in lib/supabase/proxy.ts). */
export const PUBLIC_PAGES = ["/login", "/privacy", "/terms"];

/**
 * The page routes of the build, sorted. The manifest maps each file under
 * app/ to its route: pages end in "/page", route handlers (the API routes
 * and the favicon) end in "/route" and are left out, and so are the
 * built-in not-found and error routes, which start with "/_".
 */
export function builtPageRoutes(root = process.env.TEST_REPO_ROOT) {
  const file = path.join(root, ".next", "app-path-routes-manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read the route list of the build (${file}): ${err.message}. Build the app first (npm test does).`);
  }
  return Object.entries(manifest)
    .filter(([appPath, route]) => appPath.endsWith("/page") && !route.startsWith("/_"))
    .map(([, route]) => route)
    .sort();
}

/**
 * Every page route of the build with the real address to open:
 * [{ route: "/leads/[id]", path: "/leads/7" }, ...].
 * Throws when the build and PAGE_ADDRESS do not list exactly the same routes.
 */
export function pageAddresses(ids, root = process.env.TEST_REPO_ROOT) {
  const built = builtPageRoutes(root);
  const listed = Object.keys(PAGE_ADDRESS);
  const notListed = built.filter((route) => !listed.includes(route));
  const notBuilt = listed.filter((route) => !built.includes(route));
  if (notListed.length || notBuilt.length) {
    throw new Error(
      "tests/helpers/pages.mjs does not match the build." +
        (notListed.length ? ` Page routes of the build that are not listed there: ${notListed.join(", ")}.` : "") +
        (notBuilt.length ? ` Listed there, but not a page route of the build: ${notBuilt.join(", ")}.` : "")
    );
  }
  return built.map((route) => {
    const address = PAGE_ADDRESS[route](ids);
    if (typeof address !== "string" || !address.startsWith("/") || /[[\]]|undefined|null/.test(address)) {
      throw new Error(`tests/helpers/pages.mjs gives no real address for ${route}: ${address}`);
    }
    return { route, path: address };
  });
}
