import { createApp } from "./app.js";
const { app } = createApp({ demo: process.argv.includes("--demo") });
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `invoicepilot running at http://${process.env.HOST || "127.0.0.1"}:${port}`,
  ),
);
