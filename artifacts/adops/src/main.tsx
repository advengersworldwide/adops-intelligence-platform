import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "./lib/auth";
import App from "./App";
import "./index.css";

// Supply the stored JWT to the generated API client on every request
setAuthTokenGetter(() => getToken());

createRoot(document.getElementById("root")!).render(<App />);
