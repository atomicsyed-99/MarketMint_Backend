import type { Context } from "hono";
import { runReconcile } from "@/jobs/reconcile-shopify-apps";
import { createLogger } from "@/lib/logger";

const log = createLogger("internal-reconcile-shopify-apps");

export async function reconcileShopifyAppsHandler(c: Context) {
  try {
    await runReconcile();
    return c.json({ success: true });
  } catch (err) {
    log.error({ err }, "reconcile-shopify-apps failed");
    return c.json({ error: "Reconcile failed" }, 500);
  }
}
