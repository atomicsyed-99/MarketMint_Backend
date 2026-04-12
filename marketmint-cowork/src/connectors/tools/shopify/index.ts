import { createShopifyProductTools } from "./products";
import { createShopifyOrderTools } from "./orders";
import { createShopifyCustomerTools } from "./customers";
import { createShopifyInventoryTools } from "./inventory";
import { createShopifyCollectionTools } from "./collections";
import { createShopifyDiscountTools } from "./discounts";
import { createShopifyDraftOrderTools } from "./draft-orders";
import { createShopifyMiscTools } from "./misc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyConnectorTools(
  connectionId: string,
  providerConfigKey: string,
): Record<string, any> {
  return {
    ...createShopifyProductTools(connectionId, providerConfigKey),
    ...createShopifyOrderTools(connectionId, providerConfigKey),
    ...createShopifyCustomerTools(connectionId, providerConfigKey),
    ...createShopifyInventoryTools(connectionId, providerConfigKey),
    ...createShopifyCollectionTools(connectionId, providerConfigKey),
    ...createShopifyDiscountTools(connectionId, providerConfigKey),
    ...createShopifyDraftOrderTools(connectionId, providerConfigKey),
    ...createShopifyMiscTools(connectionId, providerConfigKey),
  };
}
