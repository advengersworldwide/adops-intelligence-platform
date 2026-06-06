import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.NODE_EXPRESS_SENTRY_DSN,

  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  includeLocalVariables: true,
  enableLogs: true,
});
