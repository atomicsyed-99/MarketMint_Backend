import { Context } from "hono"
import { db } from "@/db/client";
import { sql } from "drizzle-orm";


export async function truncateAgentConfigsHandler(c: Context) {
  await db.execute(sql`TRUNCATE TABLE agent_configs CASCADE`)
  return c.json({ message: "Agent configs truncated" })
}