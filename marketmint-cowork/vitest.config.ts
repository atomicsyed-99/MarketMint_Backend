import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      MASTRA_DATABASE_URL: "postgres://test:test@localhost:5432/test",
      CLERK_SECRET_KEY: "sk_test_placeholder",
      CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
    },
  },
});
