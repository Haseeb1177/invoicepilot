import { type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/base.js";
export async function fixture(t: TestContext) {
  const { app, db } = createApp({ dbPath: ":memory:", demo: true });
  db.prepare("INSERT INTO users(org,email,password,role) VALUES(?,?,?,?)").run(
    2,
    "other@demo.local",
    hashPassword("PortfolioDemo!2026"),
    "admin",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number };
  t.after(() => {
    server.closeAllConnections();
    server.close();
    db.close();
  });
  const call = async (
    path: string,
    body?: unknown,
    cookie = "",
    header = true,
  ) => {
    const r = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(header ? { "X-Requested-With": "portfolio-app" } : {}),
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("application/pdf")
        ? Buffer.from(await r.arrayBuffer())
        : await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
    };
  };
  const login = async (email = "admin@demo.local") =>
    (await call("/login", { email, password: "PortfolioDemo!2026" })).cookie;
  return { db, call, login, cookie: await login() };
}
