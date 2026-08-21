import { env } from "./config/env";
import app from "./app";

const server = app.listen(env.PORT, () => {
  console.log(
    `Sure-Buy API running on port ${env.PORT}`,
  );
});

function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down server...`);

  server.close(async () => {
    console.log("HTTP server closed.");

    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));