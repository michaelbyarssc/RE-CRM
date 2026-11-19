// Test configuration and the database guard.
//
// Only TEST_* variables are read from the outer environment. The outer
// DATABASE_URL and any .env file are never used.

export const DEFAULT_TEST_DATABASE_URL =
  "postgres://recrm_test:recrm_test@127.0.0.1:5432/recrm_test";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Refuse any database that is not local or whose name does not end in _test.
 * Returns the parsed parts on success, throws on failure.
 */
export function assertSafeTestDatabase(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`Refusing to run: TEST_DATABASE_URL must be a postgres URL, got ${url.protocol}`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing to run: database host "${url.hostname}" is not local (allowed: 127.0.0.1, localhost, ::1)`
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to run: database name "${database}" does not end in _test`);
  }
  return { host: url.hostname, port: url.port || "5432", database };
}

export function testConfig(env = process.env) {
  const databaseUrl = env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const appPort = Number(env.TEST_APP_PORT || 3100);
  const noCronPort = Number(env.TEST_APP_NOCRON_PORT || appPort + 1);
  const authPort = Number(env.TEST_AUTH_PORT || 54329);
  return {
    databaseUrl,
    appPort,
    noCronPort,
    authPort,
    appUrl: `http://127.0.0.1:${appPort}`,
    noCronUrl: `http://127.0.0.1:${noCronPort}`,
    authUrl: `http://127.0.0.1:${authPort}`,
  };
}

// Dummy values only. None of these is a real credential.
export const GOOGLE_CLIENT_ID = "test-client-id";
export const GOOGLE_CLIENT_SECRET = "test-client-secret-0123456789";
export const SUPABASE_ANON_KEY = "test-anon-key";
