import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const options = { demo: process.argv.includes("--demo") };
const config = loadConfig(options);
const { app, db } = createApp(options);
const server = app.listen(config.port, config.host, () => {
  console.log(`invoicepilot listening on ${config.host}:${config.port}`);
});
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: draining requests`);
  const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
  deadline.unref();
  server.close(() => {
    clearTimeout(deadline);
    db.close();
    console.log("Database closed; shutdown complete");
  });
}
server.on("error", (error) => {
  console.error("Server failed to listen:", error.message);
  db.close();
  process.exitCode = 1;
});
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
