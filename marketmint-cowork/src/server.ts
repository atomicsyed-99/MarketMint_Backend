import { Hono } from "hono";
import type { HonoBindings, HonoVariables } from "@mastra/hono";
import { MastraServer } from "@mastra/hono";
import { mastra } from "./mastra";
import { setupGracefulShutdown } from "./lib/shutdown";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();

const server = new MastraServer({ app, mastra });

await server.init();

setupGracefulShutdown(null);

export default app;
