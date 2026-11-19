// Finds every app/api/**/route.ts file and the HTTP methods it exports.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === "route.ts" || name === "route.js") out.push(full);
  }
  return out;
}

/** [{ file, template: "/api/leads/[id]", path: "/api/leads/1", methods: [...] }] */
export function discoverRoutes(root = process.env.TEST_REPO_ROOT) {
  const apiDir = path.join(root, "app", "api");
  return walk(apiDir)
    .sort()
    .map((file) => {
      const rel = path.relative(path.join(root, "app"), path.dirname(file)).split(path.sep).join("/");
      const template = "/" + rel;
      const source = readFileSync(file, "utf8");
      const methods = METHODS.filter((m) =>
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`).test(source)
      );
      return { file, template, path: template.replace(/\[[^\]]+\]/g, "1"), methods };
    });
}
