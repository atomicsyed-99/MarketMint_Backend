export type AuthType = "oauth" | "api-key";

export interface ConnectionInfo {
  providerConfigKey: string;
  connectionId: string;
  apiKeys?: Record<string, string>;
}

export type Connections = Record<string, ConnectionInfo | null>;

export interface ApiKeyField {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
}

export interface ConnectorDefinition {
  /** Unique connector identifier, e.g. 'shopify', 'meta-ads' */
  id: string;
  /** Display name, e.g. 'Shopify' */
  name: string;
  /** Short description for UI */
  description: string;
  /** Nango provider config key, e.g. 'shopify', 'meta-marketing-api' */
  providerConfigKey: string;
  /** Authentication method */
  authType: AuthType;
  /** Fields for API-key auth (only for authType 'api-key') */
  apiKeyFields?: ApiKeyField[];
  /** Factory producing tools for a connection. providerConfigKey is required
   *  so per-client Shopify apps route through the correct Nango integration. */
  toolFactory: (
    connectionId: string,
    apiKeys: Record<string, string> | undefined,
    providerConfigKey: string,
  ) => Record<string, any>;
  /** Markdown block describing capabilities, injected into system prompt */
  capabilities: string;
  /** Feature flag — set false to disable without removing code */
  enabled: boolean;
}
