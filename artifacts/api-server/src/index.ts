import app from "./app";
import { logger } from "./lib/logger";
import { seedDefaults } from "./lib/seed";

const rawPort = process.env["PORT"];
const jwtSecret = process.env["JWT_SECRET"];
const groqKey = process.env["GROQ"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
if (!jwtSecret) {
  throw new Error("JWT_SECRET environment variable is required but was not provided.");
}
if (!groqKey) {
  throw new Error("GROQ environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

seedDefaults()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to seed database");
    process.exit(1);
  });
