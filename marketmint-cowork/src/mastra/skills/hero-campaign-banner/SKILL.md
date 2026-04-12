---
name: hero-campaign-banner
description: 'Use this to create large campaign banners for your homepage, email headers, or landing pages. Big, bold, brand-forward visuals.'
workflow_id: social_static_ad
use_case_id: hero_campaign_banner
---

# Hero Campaign Banner — Guidelines

This skill covers user requests for **large campaign banners** for homepage, email headers, or landing pages: big, bold, brand-forward visuals.

Example requests:
- "Create a hero banner for this product for our homepage."
- "I need a large campaign banner for our email header."
- "Make a bold landing page hero with this product."

---
## Inputs

**Required:**
- **product_image** (string URL): Exactly **one** product image. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_image is missing, ask the user to provide via one of these options. Only one image is accepted; if the user provides multiple, pick the most relevant one or ask them to choose.

**Optional:**
- **reference_image** (string URL): Exactly **one** reference image for inspiration or style. The user may or may not attach this. Only one image; omit if not provided.

**Fixed (defaults; use these unless the user specifies otherwise):**
- **user_query** (string): Short summary of the request (e.g. "User wants a hero banner"). Derive from the user's message or use this default.
- **textMessage**: `"Proceed"`
- **aspect_ratio**: `"1:1"`
- **output_format**: `"jpeg"`
- **num_variations**: `4`
- **model_selection**: `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
- If the user specifies a different aspect_ratio, num_variations, or output_format, use the user's values in the execute_workflow call.

---
## How to obtain inputs

- **Product image:** User can provide via **upload**, **extract from URL**, or **search from web**. If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl`. Show results, get approval, then use **one** approved URL as product_image.
  - If they want to **search by description** (no URL) → use `searchImages`. Show results, get approval, then use **one** chosen URL as product_image.
- **Reference image:** If the user uploads or provides one reference image for inspiration, use it as **reference_image**. Only one image allowed; omit if not provided.
- **user_query:** Take from the user's message or use "User wants a hero banner".

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_image** (and optionally reference_image), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"social_static_ad"`
- `use_case_id` = `"hero_campaign_banner"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["product_image", "reference_image"] (or only the fields the user actually edited), "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **user_query** (string): Short summary (e.g. "User wants a hero banner").
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"jpeg"`
  - **product_image** (string): Required. Single image URL only.
  - **num_variations** (number): `4`
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **reference_image** (string): Optional. Single image URL only. Omit if not provided.

---
## Example execute_workflow call

When you have product_image (and optional reference_image):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "social_static_ad",
    "use_case_id": "hero_campaign_banner",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_image", "reference_image"], "brandMemoryEnabled": true },
      "user_query": "User wants a hero banner",
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "jpeg",
      "product_image": "https://example.com/product.png",
      "num_variations": 4,
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "reference_image": "https://example.com/reference.png"
    }
  }
}
```

Omit **reference_image** if not provided. **product_image** and **reference_image** must each be a single URL string. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user wants **large campaign banners** for homepage, email headers, or landing pages — big, bold, brand-forward visuals. Not for small static ads or multi-image carousels; use Static Ad Creative or other space skills for those.
- When you have product_image (and optional reference_image), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different product or reference), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about hero/campaign banners, do **not** use this skill.
