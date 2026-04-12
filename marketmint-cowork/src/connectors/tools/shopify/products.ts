import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyProductTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── List Products ─────────────────────────────────────
    shopify_list_products: createTool({
      id: "shopify-list-products",
      description:
        "List products from the connected Shopify store. Returns product titles, prices, inventory, and status. Prices are raw numbers in the store's base currency — call shopify_get_shop first to know the currency, then display with the correct symbol. Never assume USD. If the user wants prices in a different currency, convert using exchange rates.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max number of products to return (default 10)"),
        collection_id: z
          .string()
          .optional()
          .describe("Filter by collection ID"),
        product_type: z
          .string()
          .optional()
          .describe("Filter by product type"),
        status: z
          .enum(["active", "archived", "draft"])
          .optional()
          .describe("Filter by status"),
      }),
      execute: async ({ limit, ...filters }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/products.json`,
            { params: { limit, ...filters } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Get Product ───────────────────────────────────────
    shopify_get_product: createTool({
      id: "shopify-get-product",
      description:
        "Get a single product by its Shopify product ID. Includes variants, images, and all details.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
      }),
      execute: async ({ product_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Count Products ────────────────────────────────────
    shopify_count_products: createTool({
      id: "shopify-count-products",
      description:
        "Get a count of products in the store, optionally filtered.",
      inputSchema: z.object({
        status: z
          .enum(["active", "archived", "draft"])
          .optional()
          .describe("Filter by status"),
        product_type: z
          .string()
          .optional()
          .describe("Filter by product type"),
        vendor: z.string().optional().describe("Filter by vendor"),
      }),
      execute: async (params) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/products/count.json`,
            { params },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Product ────────────────────────────────────
    shopify_create_product: createTool({
      id: "shopify-create-product",
      description:
        'Create a new product in the Shopify store. Products with status "active" are automatically published to the Online Store.',
      inputSchema: z.object({
        title: z.string().describe("Product title"),
        body_html: z
          .string()
          .optional()
          .describe("Product description in HTML"),
        vendor: z.string().optional().describe("Product vendor"),
        product_type: z
          .string()
          .optional()
          .describe("Product type/category"),
        tags: z.string().optional().describe("Comma-separated tags"),
        status: z
          .enum(["active", "archived", "draft"])
          .optional()
          .default("draft")
          .describe("Product status"),
        published: z
          .boolean()
          .optional()
          .describe(
            "Whether to publish to the Online Store. Defaults to true when status is active.",
          ),
        variants: z
          .array(
            z.object({
              price: z.string().optional().describe("Variant price"),
              sku: z.string().optional().describe("Variant SKU"),
              inventory_quantity: z
                .number()
                .optional()
                .describe("Stock quantity"),
              option1: z
                .string()
                .optional()
                .describe("Option 1 value (e.g., size)"),
              option2: z
                .string()
                .optional()
                .describe("Option 2 value (e.g., color)"),
            }),
          )
          .optional()
          .describe("Product variants with pricing"),
      }),
      execute: async ({ published, ...params }) => {
        try {
          const product: Record<string, unknown> = { ...params };
          if (published !== false && params.status === "active") {
            product.published_at = new Date().toISOString();
          } else if (published === true) {
            product.published_at = new Date().toISOString();
          }
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/products.json`,
            { body: { product } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Update Product ────────────────────────────────────
    shopify_update_product: createTool({
      id: "shopify-update-product",
      description:
        "Update an existing product in Shopify (title, description, tags, vendor, type, status, published).",
      inputSchema: z.object({
        product_id: z
          .string()
          .describe("The Shopify product ID to update"),
        title: z.string().optional().describe("New product title"),
        body_html: z
          .string()
          .optional()
          .describe("New product description"),
        vendor: z.string().optional().describe("New vendor"),
        product_type: z
          .string()
          .optional()
          .describe("New product type"),
        tags: z
          .string()
          .optional()
          .describe("New comma-separated tags"),
        status: z
          .enum(["active", "archived", "draft"])
          .optional()
          .describe("New status"),
        published: z
          .boolean()
          .optional()
          .describe(
            "Set to true to publish to Online Store, false to unpublish",
          ),
      }),
      execute: async ({ product_id, published, ...updates }) => {
        try {
          const product: Record<string, unknown> = {
            id: product_id,
            ...updates,
          };
          if (published === true) {
            product.published_at = new Date().toISOString();
          } else if (published === false) {
            product.published_at = null;
          }
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "PUT",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}.json`,
            { body: { product } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Publish Products ──────────────────────────────────
    shopify_publish_products: createTool({
      id: "shopify-publish-products",
      description:
        "Publish one or more products to the Online Store sales channel. Use this when products are active but not visible on the storefront (published_at is null).",
      inputSchema: z.object({
        product_ids: z
          .array(z.string())
          .describe("Array of Shopify product IDs to publish"),
      }),
      execute: async ({ product_ids }) => {
        try {
          const results = await Promise.all(
            product_ids.map((pid) =>
              nangoProxy(
                providerConfigKey,
                connectionId,
                "PUT",
                `/admin/api/${API_VERSION}/products/${sanitizeResourceId(pid)}.json`,
                {
                  body: {
                    product: {
                      id: pid,
                      published_at: new Date().toISOString(),
                    },
                  },
                },
              ),
            ),
          );
          return { published: product_ids.length, results };
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Delete Product ────────────────────────────────────
    shopify_delete_product: createTool({
      id: "shopify-delete-product",
      description:
        "Delete a product from Shopify. WARNING: This is irreversible. Always confirm with user first.",
      inputSchema: z.object({
        product_id: z
          .string()
          .describe("The Shopify product ID to delete"),
      }),
      execute: async ({ product_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "DELETE",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Variants ─────────────────────────────────────
    shopify_list_variants: createTool({
      id: "shopify-list-variants",
      description: "List all variants for a specific product.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
      }),
      execute: async ({ product_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/variants.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Update Variant ────────────────────────────────────
    shopify_update_variant: createTool({
      id: "shopify-update-variant",
      description:
        "Update a Shopify product variant (price, SKU, compare-at price, weight, inventory tracking, options).",
      inputSchema: z.object({
        variant_id: z.string().describe("The Shopify variant ID"),
        price: z
          .string()
          .optional()
          .describe('New price (e.g., "80.00")'),
        compare_at_price: z
          .string()
          .optional()
          .describe("Compare-at price for showing discounts"),
        sku: z.string().optional().describe("New SKU"),
        inventory_management: z
          .enum(["shopify", "fulfillment_service"])
          .nullable()
          .optional()
          .describe(
            'Inventory tracking service. "shopify" to track inventory in Shopify, "fulfillment_service" for third-party, or null to disable tracking',
          ),
        inventory_policy: z
          .enum(["deny", "continue"])
          .optional()
          .describe(
            '"deny" to stop selling when out of stock, "continue" to allow overselling',
          ),
        weight: z.number().optional().describe("Weight value"),
        weight_unit: z
          .enum(["g", "kg", "oz", "lb"])
          .optional()
          .describe("Weight unit"),
        option1: z
          .string()
          .optional()
          .describe("Option 1 value (e.g., size)"),
        option2: z
          .string()
          .optional()
          .describe("Option 2 value (e.g., color)"),
        option3: z.string().optional().describe("Option 3 value"),
      }),
      execute: async ({ variant_id, ...updates }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "PUT",
            `/admin/api/${API_VERSION}/variants/${sanitizeResourceId(variant_id)}.json`,
            { body: { variant: { id: variant_id, ...updates } } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Variant ────────────────────────────────────
    shopify_create_variant: createTool({
      id: "shopify-create-variant",
      description:
        "Add a new variant to an existing product.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
        price: z.string().optional().describe("Variant price"),
        sku: z.string().optional().describe("Variant SKU"),
        inventory_quantity: z
          .number()
          .optional()
          .describe("Stock quantity"),
        option1: z
          .string()
          .optional()
          .describe("Option 1 value (e.g., size)"),
        option2: z
          .string()
          .optional()
          .describe("Option 2 value (e.g., color)"),
        option3: z.string().optional().describe("Option 3 value"),
        barcode: z
          .string()
          .optional()
          .describe("Barcode (ISBN, UPC, etc.)"),
        weight: z.number().optional().describe("Weight value"),
        weight_unit: z
          .enum(["g", "kg", "oz", "lb"])
          .optional()
          .describe("Weight unit"),
        inventory_management: z
          .enum(["shopify", "fulfillment_service"])
          .nullable()
          .optional()
          .describe("Inventory tracking service"),
        inventory_policy: z
          .enum(["deny", "continue"])
          .optional()
          .describe(
            '"deny" to stop selling when out of stock, "continue" to allow overselling',
          ),
      }),
      execute: async ({ product_id, ...variant }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/variants.json`,
            { body: { variant } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Delete Variant ────────────────────────────────────
    shopify_delete_variant: createTool({
      id: "shopify-delete-variant",
      description:
        "Delete a variant from a product.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
        variant_id: z
          .string()
          .describe("The variant ID to delete"),
      }),
      execute: async ({ product_id, variant_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "DELETE",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/variants/${sanitizeResourceId(variant_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Upload Product Image ──────────────────────────────
    shopify_upload_product_image: createTool({
      id: "shopify-upload-product-image",
      description:
        "Upload an image to a Shopify product via URL.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
        image_url: z
          .string()
          .url()
          .describe("Public URL of the image to upload"),
        alt: z
          .string()
          .optional()
          .describe("Alt text for the image"),
        position: z
          .number()
          .optional()
          .describe("Image position (1 = primary)"),
      }),
      execute: async ({ product_id, image_url, alt, position }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/images.json`,
            { body: { image: { src: image_url, alt, position } } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Product Images ───────────────────────────────
    shopify_list_product_images: createTool({
      id: "shopify-list-product-images",
      description: "List all images for a specific product.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
      }),
      execute: async ({ product_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/images.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Delete Product Image ──────────────────────────────
    shopify_delete_product_image: createTool({
      id: "shopify-delete-product-image",
      description:
        "Delete an image from a product.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
        image_id: z.string().describe("The image ID to delete"),
      }),
      execute: async ({ product_id, image_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "DELETE",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/images/${sanitizeResourceId(image_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Get Product Metafields ────────────────────────────
    shopify_get_product_metafields: createTool({
      id: "shopify-get-product-metafields",
      description:
        "Get metafields for a product (custom data like specs, dimensions, etc.).",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
      }),
      execute: async ({ product_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/metafields.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Product Metafield ──────────────────────────
    shopify_create_product_metafield: createTool({
      id: "shopify-create-product-metafield",
      description:
        "Create/set a metafield on a product.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
        namespace: z
          .string()
          .describe('Metafield namespace (e.g., "custom")'),
        key: z.string().describe("Metafield key"),
        value: z.string().describe("Metafield value"),
        type: z
          .enum([
            "single_line_text_field",
            "multi_line_text_field",
            "number_integer",
            "number_decimal",
            "boolean",
            "json",
            "url",
            "color",
          ])
          .describe("Metafield value type"),
      }),
      execute: async ({ product_id, namespace, key, value, type }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/products/${sanitizeResourceId(product_id)}/metafields.json`,
            { body: { metafield: { namespace, key, value, type } } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
