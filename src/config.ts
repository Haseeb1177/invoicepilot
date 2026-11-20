import { isAbsolute } from "node:path";
import { z } from "zod";

export type Options = {
  dbPath?: string;
  demo?: boolean;
  env?: NodeJS.ProcessEnv;
};

export function loadConfig(options: Options = {}) {
  const env = options.env ?? process.env;
  const production = env.NODE_ENV === "production" || env.RENDER === "true";
  if (production && options.demo) {
    throw new Error("Demo credentials are disabled in production.");
  }
  const dbPath = options.dbPath ?? env.DB_PATH ?? "data/app.sqlite";
  if (production && !isAbsolute(dbPath)) {
    throw new Error(
      "Production DB_PATH must be an absolute path on a persistent disk.",
    );
  }
  const origins = (env.APP_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (
        url.origin !== value ||
        url.username ||
        url.password ||
        (production
          ? url.protocol !== "https:"
          : !["https:", "http:"].includes(url.protocol))
      )
        throw new Error(
          "APP_ORIGINS must contain exact origins without paths or trailing slashes; production requires HTTPS.",
        );
      return url.origin;
    });
  if (production && !origins.length) {
    throw new Error("Set APP_ORIGINS to the exact HTTPS frontend origin.");
  }
  const adminEmail = (env.ADMIN_EMAIL ?? "admin@example.com")
    .trim()
    .toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD;
  if (production) {
    if (!env.ADMIN_EMAIL || !z.email().max(200).safeParse(adminEmail).success) {
      throw new Error("Set ADMIN_EMAIL to a valid administrator email.");
    }
    if (
      !adminPassword ||
      adminPassword.length < 16 ||
      adminPassword.length > 256 ||
      /PortfolioDemo!2026|replace-with|change.?me|your[-_ ]password/i.test(
        adminPassword,
      )
    )
      throw new Error(
        "Set ADMIN_PASSWORD to a unique 16–256 character password; examples are not allowed.",
      );
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  const trustProxy = Number(env.TRUST_PROXY_HOPS ?? (production ? "1" : "0"));
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 2) {
    throw new Error(
      "TRUST_PROXY_HOPS must be 0, 1 or 2, matching the verified proxy path.",
    );
  }
  return {
    production,
    dbPath,
    origins,
    adminEmail,
    adminPassword,
    trustProxy,
    port,
    host: env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    cookieName: production ? "__Host-session" : "session",
  };
}
