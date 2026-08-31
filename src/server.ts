
import { env } from "./config/env";
import app from "./app";

const HOST = "0.0.0.0";

const server = app.listen(env.PORT, HOST, () => {
  console.log(
    `Sure-Buy API running on ${HOST}:${env.PORT}`,
  );
});

function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down server...`);

  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
