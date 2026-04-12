import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/env";

const queryClient = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX ?? 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export async function closeDb(): Promise<void> {
  await queryClient.end();
}

