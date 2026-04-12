---
name: shopify-storefront
description: 'Use when the user wants to check their Shopify store, see what products they have, fetch product images from their store, or do something with those images (e.g. generate marketing creatives from their product photos). Requires the store link (*.myshopify.com).'
---

# Shopify Storefront — Guidelines

This skill covers requests about the user's Shopify store: listing products, fetching product images, or using those images for generation (e.g. marketing creatives, ad images).

Example requests:
- "Check out my Shopify store and show me what I have"
- "Get images of items listed on my Shopify store"
- "Fetch product images from my store and generate marketing creatives for them"
- "I want to use my store's product photos to make social ads"

---
## Required input (store URL)

- **First**: Call **checkLinkedShopifyAccount** (no arguments). This checks if the user has a connected Shopify account (v2 only).
- **If** the tool returns **has_shopify: true** and **shop_domain**: use that **shop_domain** as **store_url** when calling **searchShopifyCatalog**. Do NOT ask the user for their store link.
- **If** the tool returns **has_shopify: false** (or no shop_domain): do **NOT** ask for the store link in chat. Call **show_shopify_connect_banner** (optionally with store_url, description, store_name if the user already mentioned them). This shows the Shopify connect card in the UI. When the user completes OAuth, the frontend will send a message (e.g. user_action_response or content part) containing the **store domain** (e.g. storeUrl, shop_domain). When you see that payload, call **searchShopifyCatalog(store_url=<that store domain>)** and then proceed with the user's request (e.g. list products, fetch images, generate creatives).

---
## OAuth response (store domain from frontend)

- When the **user message** contains a payload from the frontend **after Shopify OAuth** (e.g. user_action_response, or a content part with store domain), extract the **store domain** (field may be **storeUrl**, **shop_domain**, or **store_domain**). Call **searchShopifyCatalog(store_url=<that domain>)** with that value, then continue with the user's intent (list products, use images for creatives, etc.). Only **\*.myshopify.com** domains are supported.

---
## User denied connecting (Skip or closed popup)

- When the **user message** contains a content part with **type: "user_action_response"** and **data.response.denied: true** (user clicked Skip or closed the Shopify connect popup), do **not** call **searchShopifyCatalog** or show the connect banner again. Simply acknowledge and ask what they would like to do next (e.g. help with something else, try connecting later, or use product images from another source).

---
## Required tools

1. **checkLinkedShopifyAccount** — Call this first (v2 only). Returns has_shopify and shop_domain if the user has a connected Shopify account.
2. **show_shopify_connect_banner** — Call when has_shopify is false (v2 only). Shows the connect card in the UI; do not ask for the store link in chat. Optional args: store_url, description, store_name.
3. **searchShopifyCatalog** — Query the store's catalog. Use the shop_domain from checkLinkedShopifyAccount when available, or the store domain from the OAuth response payload; otherwise use the store URL the user provided. No authentication required for the Storefront MCP itself.

---
## searchShopifyCatalog parameters

- **store_url**: The store's Shopify domain (e.g. mystore.myshopify.com or https://mystore.myshopify.com). Must be \*.myshopify.com.
- **query**: Search phrase for the catalog (e.g. "shoes", "coffee", or "products" for a general list). Use what the user asked for. **When the user says "show all products", "list everything", or similar, call `searchShopifyCatalog` with `query=""` (empty string) so the store returns the full catalog instead of a small default subset.**
- **context**: Optional string to tailor results (e.g. "Customer wants to see all products" or the user's stated goal). Default is fine if not specified.

The tool returns **products** (name, price, product_url, image_url, description) and **key_image_urls** (list of product image URLs). It streams product images to the UI and adds them to the asset catalog for downstream use.

---
## When the user wants to "do something" with the product images

- If the user wants to **generate creatives, marketing images, or ads** from their store's product images:
  1. Call **checkLinkedShopifyAccount** first; if it returns has_shopify true and shop_domain, use that as store_url. If has_shopify false, call **show_shopify_connect_banner** (do not ask for store link); when the OAuth response arrives with store domain, use that as store_url.
  2. Call **searchShopifyCatalog** with that store_url and an appropriate query.
  3. Use the returned **key_image_urls** (or product image_urls) as **asset_urls** when calling **directImageGen** (or pass to **execute_workflow** if a specific workflow fits). The tool streams images to the UI and they are available in the asset catalog.
  4. Do not re-ask for the store link if you already have it (from checkLinkedShopifyAccount or the same conversation).

- If the user only wants to **see what's on their store** or **list products**, call **searchShopifyCatalog** and present the results (products and streamed images). No need to call directImageGen unless they ask for generation.

---
## Behavioral guidelines

- **Always call checkLinkedShopifyAccount first** (v2). If it returns a connected Shopify (has_shopify true, shop_domain), use that shop_domain for searchShopifyCatalog and do not ask for the store link.
- If the user has not linked Shopify (has_shopify false), call **show_shopify_connect_banner**; do not ask for the store link in chat. When the frontend sends the OAuth response with store domain, call **searchShopifyCatalog** with that store_url and proceed. Use only \*.myshopify.com URLs.
- When the user’s request is about **“products from my Shopify store”** but they have **not specified a particular product or category** (e.g. just “show products from my store”), then **after** you have the store connected / store_url resolved, first ask a short clarification like: “Which product or type of product would you like to focus on (e.g. jackets, shoes, a specific SKU)?” and use their answer to set a more specific `query` for `searchShopifyCatalog`. Only skip this clarification when they clearly say they want **all products** (e.g. “show all products”, “list everything”)—in that case, use `query=""` as described above.
- Use **searchShopifyCatalog** for all catalog/product listing and product image fetching from a Shopify store.
- When the user wants generation (creatives, ads) from store product images, use the **key_image_urls** from the tool result as **asset_urls** in **directImageGen** (or the asset catalog) and follow the creative-generation guidelines for that step.
