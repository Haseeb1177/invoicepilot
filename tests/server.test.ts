import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

test(
  "Production server starts on PORT, serves health and drains on SIGTERM",
  { timeout: 15_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "server-smoke-"));
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = spawn(
      process.execPath,
      ["--env-file-if-exists=.env", "--import", "tsx", "src/server.ts"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOST: "0.0.0.0",
          PORT: String(port),
          DB_PATH: join(directory, "app.sqlite"),
          APP_ORIGINS: "https://smoke.example.com",
          ADMIN_EMAIL: "smoke@example.com",
          ADMIN_PASSWORD: randomBytes(24).toString("hex"),
        },
      },
    );
    const ended = once(child, "exit");
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Startup timed out: " + output));
        }, 8_000);
        const inspect = () => {
          if (output.includes(`listening on 0.0.0.0:${port}`)) {
            cleanup();
            resolve();
          }
        };
        const failed = () => {
          cleanup();
          reject(new Error("Server exited during startup: " + output));
        };
        function cleanup() {
          clearTimeout(timeout);
          child.stdout.off("data", inspect);
          child.off("exit", failed);
        }
        child.stdout.on("data", inspect);
        child.once("exit", failed);
      });
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      child.kill("SIGTERM");
      const [code, signal] = await ended;
      assert.equal(code, 0, output);
      assert.equal(signal, null);
      assert.match(output, /Database closed; shutdown complete/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await ended;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
