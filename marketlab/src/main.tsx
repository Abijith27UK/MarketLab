import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import "./styles/globals.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

if (!convexUrl) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <div style={{ padding: 32, fontFamily: "sans-serif", color: "#e8e8f0", background: "#0a0a0f", minHeight: "100vh" }}>
      <h1>MarketLab configuration required</h1>
      <p>
        <code>VITE_CONVEX_URL</code> is not set. Run <code>npx convex dev</code> in the
        project directory to configure a Convex deployment, then restart the dev server.
      </p>
    </div>
  );
} else {
  const convex = new ConvexReactClient(convexUrl);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConvexAuthProvider client={convex}>
          <App />
        </ConvexAuthProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
