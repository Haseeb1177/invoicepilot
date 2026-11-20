import { spawn } from "node:child_process";

// Forward npm's extra arguments to Vite (for example --port 4173 --strictPort).
const apiPort = process.env.API_PORT ?? "3000";
const children = [
  spawn(
    process.execPath,
    ["--import", "tsx", "--watch", "src/server.ts", "--demo"],
    {
      stdio: "inherit",
      env: { ...process.env, PORT: apiPort, HOST: "127.0.0.1" },
    },
  ),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, API_PORT: apiPort },
    },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
for (const child of children) {
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", (code) => stop(code ?? 0));
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
