import type { Connections } from "../connectors/types";
import { AGENT_JOB_CONNECTOR_ENTRIES } from "@/connectors/agent-job-provider-metadata";

function entryById(id: string) {
  const n = id.toLowerCase().trim();
  return AGENT_JOB_CONNECTOR_ENTRIES.find((e) => e.id === n);
}

function entryByNangoKey(key: string) {
  return AGENT_JOB_CONNECTOR_ENTRIES.find((e) => e.nangoKey === key);
}

/** Canonical connector row for API errors (matches `AGENT_JOB_CONNECTOR_ENTRIES`). */
export type UnmetConnectorDetail = {
  id: string;
  nangoKey: string;
  name: string;
  /** Requirement string from the job payload */
  requirement: string;
  /** True when `requirement` did not match a known catalog entry */
  unlisted?: boolean;
};

function resolveDetailForUnmetRequirement(
  requirement: string,
  keys: string[],
): UnmetConnectorDetail {
  const byId = entryById(requirement);
  if (byId) {
    return {
      id: byId.id,
      nangoKey: byId.nangoKey,
      name: byId.name,
      requirement,
    };
  }
  const byKey = keys[0] ? entryByNangoKey(keys[0]) : undefined;
  if (byKey) {
    return {
      id: byKey.id,
      nangoKey: byKey.nangoKey,
      name: byKey.name,
      requirement,
    };
  }
  const slug =
    requirement
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown";
  return {
    id: slug,
    nangoKey: keys[0] ?? slug,
    name: requirement,
    requirement,
    unlisted: true,
  };
}

/**
 * Requirements with no active Nango connection, each resolved to a canonical id/nangoKey/name for clients.
 */
export function listUnmetConnectorDetails(
  requirements: string[],
  connections: Connections,
): UnmetConnectorDetail[] {
  const out: UnmetConnectorDetail[] = [];
  for (const req of requirements) {
    const keys = requirementToNangoKeys(req);
    const connected = keys.some((k) => connections[k] != null);
    if (connected) continue;
    out.push(resolveDetailForUnmetRequirement(req, keys));
  }
  return out;
}

/**
 * Map a model/user requirement string to Nango `provider_config_key` values we accept.
 */
function requirementToNangoKeys(requirement: string): string[] {
  const n = requirement.toLowerCase().trim();
  const byId = entryById(n);
  if (byId) return [byId.nangoKey];
  const byKey = AGENT_JOB_CONNECTOR_ENTRIES.find((e) => e.nangoKey === n);
  if (byKey) return [byKey.nangoKey];
  if (n === "meta" || n === "meta ads" || n === "facebook" || n === "instagram") {
    return ["meta-marketing-api"];
  }
  if (n === "ga" || n === "ga4" || n === "google analytics") {
    return ["google-analytics"];
  }
  return [n];
}

/**
 * Returns requirement strings that have no matching active connection.
 */
export function missingConnectorConnections(
  requirements: string[],
  connections: Connections,
): string[] {
  return listUnmetConnectorDetails(requirements, connections).map((d) => d.requirement);
}

export function formatConnectionsForJobManagerPrompt(
  connections: Connections,
): string {
  const keys = Object.keys(connections).filter((k) => connections[k] != null);
  if (keys.length === 0) {
    return "None connected (user must connect integrations in Marketmint before jobs that need Shopify, Meta, etc.).";
  }
  return keys
    .map((pk) => {
      const def = entryByNangoKey(pk);
      return def ? `- ${def.id} (${def.name}) — Nango key: ${pk}` : `- ${pk}`;
    })
    .join("\n");
}