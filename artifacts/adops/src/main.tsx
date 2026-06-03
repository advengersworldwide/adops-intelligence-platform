import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import * as Sentry from "@sentry/react";
import { getToken } from "./lib/auth";
import App from "./App";
import "./index.css";

Sentry.init({
  dsn: import.meta.env.REACT_VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

// Supply the stored JWT to the generated API client on every request
setAuthTokenGetter(() => getToken());

createRoot(document.getElementById("root")!).render(<App />);
