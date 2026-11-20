import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import { loadConfig, type Options } from "./config.js";
export type { Options } from "./config.js";
export type User = { id: number; org: number; email: string; role: string };
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  ok: unknown,
  status: number,
  message: string,
): asserts ok {
  if (!ok) throw new ApiError(status, message);
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function base(options: Options) {
  const config = loadConfig(options);
  const path = config.dbPath;
  if (config.production && !existsSync(dirname(path))) {
    throw new Error(
      "Database directory is missing. Mount the persistent disk before starting the service.",
    );
  }
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,org INTEGER NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);`);
  if (
    config.production &&
    db
      .prepare(
        "SELECT id FROM users WHERE email IN ('admin@demo.local','viewer@demo.local') LIMIT 1",
      )
      .get()
  ) {
    db.close();
    throw new Error(
      "A local demo database cannot be used in production. Configure a fresh production database.",
    );
  }
  if (!db.prepare("SELECT id FROM users LIMIT 1").get()) {
    const password = options.demo ? "PortfolioDemo!2026" : config.adminPassword;
    ensure(
      password && password.length >= 16,
      500,
      "Set ADMIN_PASSWORD to at least 16 characters or use npm run demo.",
    );
    db.prepare(
      "INSERT INTO users(org,email,password,role) VALUES(?,?,?,?)",
    ).run(
      1,
      options.demo ? "admin@demo.local" : config.adminEmail,
      hashPassword(password),
      "admin",
    );
    if (options.demo)
      db.prepare(
        "INSERT INTO users(org,email,password,role) VALUES(?,?,?,?)",
      ).run(1, "viewer@demo.local", hashPassword(password), "viewer");
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(helmet());
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const origin = req.get("Origin");
    if (
      mutating &&
      config.production &&
      (!origin || !config.origins.includes(origin))
    ) {
      res.status(403).json({ error: "Request origin is not allowed" });
      return;
    }
    if (mutating && req.get("X-Requested-With") !== "portfolio-app") {
      res.status(403).json({ error: "Missing request protection header" });
      return;
    }
    next();
  });
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 60_000,
      limit: 15,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      // Account-based throttling works across the Vercel + Render proxy chain.
      keyGenerator: (req) =>
        digest(
          String(req.body?.email ?? "")
            .trim()
            .toLowerCase()
            .slice(0, 200),
        ),
      skipSuccessfulRequests: true,
      message: { error: "Too many sign-in attempts. Try again in one minute." },
    }),
    (req, res) => {
      const body = z
        .object({
          email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
          password: z.string().min(1).max(256),
        })
        .parse(req.body);
      const user = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(body.email) as (User & { password: string }) | undefined;
      const stored = user?.password || "0".repeat(32) + ":" + "0".repeat(128);
      const [salt, expected] = stored.split(":");
      const valid = timingSafeEqual(
        scryptSync(body.password, salt, 64),
        Buffer.from(expected, "hex"),
      );
      ensure(user && valid, 401, "Invalid email or password");
      const token = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        digest(token),
        user.id,
        Date.now() + 8 * 3600_000,
      );
      res.cookie(config.cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.production,
        maxAge: 8 * 3600_000,
        path: "/",
      });
      res.json({ id: user.id, email: user.email, role: user.role });
    },
  );
  app.use("/api", (req, res, next) => {
    const token =
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(config.cookieName + "="))
        ?.slice(config.cookieName.length + 1) || "";
    const user = db
      .prepare(
        "SELECT u.id,u.org,u.email,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
      )
      .get(digest(token), Date.now());
    if (!user) {
      res.status(401).json({ error: "Please sign in" });
      return;
    }
    res.locals.user = user;
    next();
  });
  app.get("/api/me", (_req, res) => res.json(res.locals.user));
  app.post("/api/logout", (req, res) => {
    const token =
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(config.cookieName + "="))
        ?.slice(config.cookieName.length + 1) || "";
    db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
    res.clearCookie(config.cookieName, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.production,
    });
    res.json({ ok: true });
  });
  function finish() {
    app.use("/api", (_req, res) =>
      res.status(404).json({ error: "Endpoint not found" }),
    );
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (req, res, next) => {
      if (
        !extname(req.path) &&
        req.accepts("html") &&
        existsSync(resolve("dist/index.html"))
      ) {
        res.sendFile(resolve("dist/index.html"));
      } else next();
    });
    app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (err instanceof ZodError) {
          res.status(400).json({
            error: err.issues
              .map((i) => i.path.join(".") + ": " + i.message)
              .join("; "),
          });
          return;
        }
        const e = err as ApiError;
        res
          .status(e.status || 500)
          .json({ error: e.status ? e.message : "Internal server error" });
        if (!e.status) console.error(err);
      },
    );
  }
  return { app, db, finish };
}
export function admin(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.user.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}
export function atomic<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
