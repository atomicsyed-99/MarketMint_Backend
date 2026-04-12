/**
 * All Shopify OAuth scopes required by Marketmint tools.
 * These are hardcoded — the user must add ALL of them in their Shopify custom app.
 * If any are missing, the corresponding tool calls will fail at runtime.
 */
export const REQUIRED_SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "write_orders",
  "read_draft_orders",
  "write_draft_orders",
  "read_customers",
  "write_customers",
  "read_inventory",
  "write_inventory",
  "read_product_listings",
  "read_collections",
  "write_collections",
  "read_price_rules",
  "write_price_rules",
  "read_discounts",
  "write_discounts",
  "read_gift_cards",
  "write_gift_cards",
  "read_themes",
  "read_content",
  "write_content",
  "read_analytics",
  "read_reports",
] as const;

export type ShopifyScope = (typeof REQUIRED_SHOPIFY_SCOPES)[number];
