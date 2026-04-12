import { defineConfig } from "mastra";

// Tell Mastra to use our custom Hono app (src/server.ts) as the app entrypoint.
export default defineConfig({
  app: "./src/server.ts",
});

