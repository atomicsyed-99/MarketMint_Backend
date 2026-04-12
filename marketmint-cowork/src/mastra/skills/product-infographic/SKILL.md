---
name: product-infographic
description: 'Use this to create an info-packed image showing multiple product features. Combine photos with icons, text callouts, and specs in one visual.'
workflow_id: product_listing
use_case_id: infographic_module
---

# Product Infographic — Guidelines

This skill covers user requests for info-packed images that show multiple product features: combine product photos with icons, text callouts, and specs in one visual.

Example requests:
- "Create an infographic for this product showing its key features."
- "I need a single image with product photo, icons, and specs."
- "Make a product infographic highlighting durability, size, and materials."

---
## Inputs

**Required:**
- **product_image** (string URL): Exactly one product image. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_image is missing, ask the user to provide via one of these options. Only one image is accepted; if the user provides multiple, pick the most relevant one or ask them to choose.
- **key_features** (string): Mandatory. What to highlight in the generated infographic. Capture anything specific the user wants (e.g. "durability, size, materials", "waterproof, battery life"). If the user has not mentioned anything specific, use a short summary of their basic requirement (e.g. "User wants a product infographic" or "Key product features and specs").

**Fixed (defaults; use these unless the user specifies otherwise):**
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
- **key_features:** Take from the user's message (e.g. "highlight weight, dimensions, and warranty"). If they don't specify, use a short summary of their request (e.g. "User wants a product infographic" or "Key product features and specs") — this field is mandatory so always provide something.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_image** and **key_features**, call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"product_listing"`
- `use_case_id` = `"infographic_module"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (all keys as below):

  - **_metadata** (dict): `{ "userEditedFields": ["product_image", "key_features"], "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **key_features** (string): Required. What to highlight (user's specific list or a short summary of their requirement).
  - **output_format** (string): `"jpeg"`
  - **product_image** (string): Required. Single image URL.
  - **num_variations** (number): `4`
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`

---
## Example execute_workflow call

When you have product_image and key_features:

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "product_listing",
    "use_case_id": "infographic_module",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_image", "key_features"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "key_features": "User wants a product infographic with key features and specs",
      "output_format": "jpeg",
      "product_image": "https://example.com/product.png",
      "num_variations": 4,
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }
    }
  }
}
```

**key_features** is mandatory — use the user's specific highlights if they gave them, otherwise a short summary of their requirement. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user asks for an infographic that combines product photo(s) with icons, text callouts, and/or specs in one visual. Not for plain product shots or ad creatives; use other space skills for those.
- When you have product_image and key_features, call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different product or features to highlight), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about product infographics, do **not** use this skill.
