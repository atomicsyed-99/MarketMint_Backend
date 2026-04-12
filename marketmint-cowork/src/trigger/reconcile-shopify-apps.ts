import { schedules } from "@trigger.dev/sdk/v3";
import { getInternalApiUrl, getApiKey } from "./internal-client";

// Reconcile stuck shopify_apps rows every 5 minutes.
// Attach cron "*/5 * * * *" via Trigger.dev dashboard after deploy.
export const reconcileShopifyAppsTask = schedules.task({
  id: "reconcile-shopify-apps",
  maxDuration: 120,
  machine: "small-1x",
  queue: { name: "reconcile-shopify-apps" },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    randomize: false,
  },
  run: async () => {
    const url = getInternalApiUrl("/cowork/internal/reconcile-shopify-apps");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": getApiKey(),
      },
    });
    if (!res.ok) {
      throw new Error(`Reconcile call failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  },
});
