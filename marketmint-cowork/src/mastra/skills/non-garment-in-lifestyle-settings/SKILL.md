---
name: non-garment-in-lifestyle-settings
description: 'Use ONLY when the user explicitly asks for a non-garment PRODUCT (object: bag, helmet, shoe, bottle, etc.) in a lifestyle or outdoor setting, or a human/model interacting with that product in a real-world scene. Do NOT use for animals (horse, dog, etc.) or for "lifestyle images of X" when X is not a product—use creative-generation for those. Do not use for generic requests like "marketing images for this shoe" without lifestyle context. If the user wants a model with a product but has not said lifestyle vs studio, clarify first; once they prefer lifestyle, select this skill.'
workflow_id: non_garment_shoot
use_case_id: non_garment_in_lifestyle_scene
---

# Non-Garment in Lifestyle — Guidelines

This skill covers user requests for generating images of non-garment products in lifestyle/outdoor settings.

Example requests:
- "Generate lifestyle images for this helmet"
- "Make a model hold this bag against a beach background"

---
## Inputs

**Required:**
- **product_images** (list of URLs): At least one product image. The user can provide via: **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_images are missing, ask the user to provide via one of these options.

**Optional:**
- **model_image** (string URL): Model reference. If the user has already shared one, use it. Do not ask for it if not provided.
- **custom_description** (string): Natural-language summary of what the user wants. Include any brand styles/themes if the user confirmed them after brand analysis.
- **num_variations** (number): Default 4 if not specified.
- **aspect_ratio**, **output_format**: Use defaults (e.g. "1:1", "jpeg") if not specified.

---
## How to obtain inputs

- **Product images:** User can provide via **upload**, **extract from URL**, or **search from web**. If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl`. Show results, get approval, then use approved URLs.
  - If they want to **search by description** (no URL) → use `searchImages`. Show results, get approval, then use chosen URL(s).
- **Model:** Same tools if the user asks to get one; if not provided, do not prompt — use from conversation if already shared.
- **Brand analysis:** If the user wants to use a brand's styles/themes, call `analyzeBrand`, show results, ask which themes to use, then merge into **custom_description**.
- **Trends:** If the user wants latest trends, use `tavilySearch`, show results, get approval, incorporate into **custom_description** if relevant.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_images** (and optionally model_image, custom_description, etc.), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"non_garment_shoot"`
- `use_case_id` = `"non_garment_in_lifestyle_scene"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["model_image"] (or fields user edited), "brandMemoryEnabled": true }`
  - **product_images** (list of strings): Required. One or more image URLs.
  - **model_image** (string URL): Optional.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"jpeg"` (or "png")
  - **num_variations** (number): e.g. 4
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **custom_description** (string): User's request or summary.

---
## Example execute_workflow call

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "non_garment_shoot",
    "use_case_id": "non_garment_in_lifestyle_scene",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["model_image"], "brandMemoryEnabled": true },
      "model_image": "https://example.com/model.png",
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "jpeg",
      "num_variations": 4,
      "product_images": ["https://example.com/product.png"],
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "custom_description": "User wants product lifestyle images."
    }
  }
}
```

Omit optional keys if not provided. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** Only when the user has clearly asked for non-garment product in a **lifestyle or outdoor** setting (e.g. lifestyle images, outdoor, model holding product, beach). If they said only "generate images for this product" without specifying lifestyle vs studio, ask whether they want lifestyle/outdoor or indoor/studio first; load only the matching skill after they confirm.
- When you have product_images (and optional others), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the request is not about lifestyle/outdoor images for non-garment products, do **not** use this skill.
