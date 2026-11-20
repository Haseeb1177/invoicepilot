import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { createVercelConfig } from "../vercel.mjs";

function settings(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "deploy-check-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    NODE_ENV: "production",
    DB_PATH: join(directory, "app.sqlite"),
    APP_ORIGINS: "https://workspace.example.com",
    ADMIN_EMAIL: "owner@example.com",
    ADMIN_PASSWORD: "Test-only-random-passphrase-419!",
  };
}
async function listen(env: NodeJS.ProcessEnv) {
  const { app, db } = createApp({ env });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    origin,
    app,
    db,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      db.close();
    },
  };
}
function headers(env: NodeJS.ProcessEnv, cookie = "") {
  return {
    "Content-Type": "application/json",
    "X-Requested-With": "portfolio-app",
    Origin: env.APP_ORIGINS!,
    Cookie: cookie,
  };
}
async function signIn(origin: string, env: NodeJS.ProcessEnv) {
  return fetch(origin + "/api/login", {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      email: " OWNER@EXAMPLE.COM ",
      password: env.ADMIN_PASSWORD,
    }),
  });
}

test("Production rejects demo mode, missing storage/origins and example passwords", (t) => {
  const env = settings(t);
  assert.throws(() => loadConfig({ env, demo: true }), /Demo credentials/);
  assert.throws(
    () => loadConfig({ env: { ...env, DB_PATH: "data/app.sqlite" } }),
    /absolute path/,
  );
  assert.throws(
    () => loadConfig({ env: { ...env, APP_ORIGINS: "" } }),
    /APP_ORIGINS/,
  );
  assert.throws(
    () =>
      loadConfig({
        env: { ...env, APP_ORIGINS: "https://workspace.example.com/" },
      }),
    /APP_ORIGINS/,
  );
  assert.throws(
    () =>
      loadConfig({
        env: { ...env, APP_ORIGINS: "http://workspace.example.com" },
      }),
    /APP_ORIGINS/,
  );
  assert.throws(
    () => loadConfig({ env: { ...env, ADMIN_PASSWORD: "PortfolioDemo!2026" } }),
    /ADMIN_PASSWORD/,
  );
  assert.throws(
    () => loadConfig({ env: { ...env, ADMIN_EMAIL: "" } }),
    /ADMIN_EMAIL/,
  );
  assert.throws(
    () => loadConfig({ env: { ...env, TRUST_PROXY_HOPS: "true" } }),
    /TRUST_PROXY/,
  );
  assert.throws(
    () =>
      createApp({
        env: { ...env, DB_PATH: join(env.DB_PATH, "missing", "db.sqlite") },
      }),
    /persistent disk/,
  );
  assert.equal(loadConfig({ env }).host, "0.0.0.0");
  assert.equal(loadConfig({ env: { ...env, PORT: "10000" } }).port, 10000);
});

test("Vercel requires a configured HTTPS backend and keeps API requests outside SPA fallback", () => {
  assert.throws(() => createVercelConfig({ VERCEL: "1" }), /API_ORIGIN/);
  for (const value of [
    "http://api.example.com",
    "https://api.example.com/",
    "https://api.example.com/path",
    "https://u:p@api.example.com",
    "https://api.example.com?q=x",
  ]) {
    assert.throws(() => createVercelConfig({ VERCEL: "1", API_ORIGIN: value }));
  }
  const config = createVercelConfig({
    VERCEL: "1",
    API_ORIGIN: "https://api.example.com",
  });
  assert.equal(
    config.rewrites[0].destination,
    "https://api.example.com/api/:path*",
  );
  const fallback = new RegExp("^" + config.rewrites[1].source + "$");
  assert.equal(fallback.test("/api/login"), false);
  assert.equal(fallback.test("/api"), false);
  assert.equal(fallback.test("/workspace"), true);
});

test("Production login enforces origins, secure cookies, no-cache and logout", async (t) => {
  const env = settings(t),
    backend = await listen(env);
  try {
    const health = await fetch(backend.origin + "/api/health");
    assert.equal(health.status, 200);
    assert.match(health.headers.get("cache-control")!, /no-store/);
    for (const Origin of ["https://attacker.example", "null", ""]) {
      const r = await fetch(backend.origin + "/api/login", {
        method: "POST",
        headers: { ...headers(env), Origin },
        body: "{}",
      });
      assert.equal(r.status, 403);
    }
    const r = await signIn(backend.origin, env);
    assert.equal(r.status, 200);
    const setCookie = r.headers.get("set-cookie")!;
    assert.match(setCookie, /^__Host-session=/);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
      assert.ok(setCookie.includes(flag));
    assert.ok(!setCookie.includes("Domain="));
    const cookie = setCookie.split(";")[0];
    assert.equal(
      (
        await fetch(backend.origin + "/api/dashboard", {
          headers: headers(env, cookie),
        })
      ).status,
      200,
    );
    const unknown = await fetch(backend.origin + "/api/not-found", {
      headers: headers(env, cookie),
    });
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get("content-type")!, /json/);
    const logout = await fetch(backend.origin + "/api/logout", {
      method: "POST",
      headers: headers(env, cookie),
      body: "{}",
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /__Host-session=;/);
    assert.equal(
      (
        await fetch(backend.origin + "/api/me", {
          headers: headers(env, cookie),
        })
      ).status,
      401,
    );
  } finally {
    await backend.close();
  }
});

test("Account throttling cannot be bypassed with case or forwarded IP changes", async (t) => {
  const env = settings(t),
    backend = await listen(env);
  try {
    for (let n = 0; n < 16; n++) {
      const response = await fetch(backend.origin + "/api/login", {
        method: "POST",
        headers: { ...headers(env), "X-Forwarded-For": `192.0.2.${n + 1}` },
        body: JSON.stringify({
          email: n % 2 ? "OWNER@example.com" : "owner@example.com",
          password: "wrong",
        }),
      });
      assert.equal(response.status, n < 15 ? 401 : 429);
      if (n === 15) assert.match((await response.json()).error, /Too many/);
    }
  } finally {
    await backend.close();
  }
});

test("A frontend proxy preserves the session and stored data survives backend restart", async (t) => {
  const env = settings(t);
  let backend = await listen(env);
  const proxy = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const requestHeaders = new Headers();
    for (const name of [
      "content-type",
      "x-requested-with",
      "origin",
      "cookie",
    ]) {
      const value = req.headers[name];
      if (typeof value === "string") requestHeaders.set(name, value);
    }
    const upstream = await fetch(backend.origin + req.url, {
      method: req.method,
      headers: requestHeaders,
      body: ["GET", "HEAD"].includes(req.method!)
        ? undefined
        : Buffer.concat(chunks),
    });
    res.statusCode = upstream.status;
    for (const name of ["content-type", "set-cookie", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  try {
    const login = await signIn(origin, env);
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const created = await fetch(origin + "/api/clients", {
      method: "POST",
      headers: headers(env, cookie),
      body: JSON.stringify({
        name: "Persistent deployment client",
        email: "client@example.com",
      }),
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    await backend.close();
    backend = await listen(env);
    const dashboard = await fetch(origin + "/api/dashboard", {
      headers: headers(env, cookie),
    });
    assert.equal(dashboard.status, 200);
    assert.ok(
      (await dashboard.json()).clients.some((a: { id: string }) => a.id === id),
    );
    // A changed bootstrap password must not silently rotate an existing account.
    assert.equal(
      (
        await signIn(origin, {
          ...env,
          ADMIN_PASSWORD: "A-different-bootstrap-password!",
        })
      ).status,
      401,
    );
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await backend.close();
  }
});

test("Production refuses an existing demo database with public credentials", (t) => {
  const env = settings(t);
  const demo = createApp({ dbPath: env.DB_PATH, demo: true, env: {} });
  demo.db.close();
  assert.throws(() => createApp({ env }), /local demo database/);
});
