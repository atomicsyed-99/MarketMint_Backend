---
name: jewellery-photoshoot
description: 'Use this to create professional jewelry photography. Rings, necklaces, earrings, watches. Clean shots that show sparkle and detail. Do not use for cases where the incoming payload contains <hidden>workflow_id=product_swap, use_case_id=product_swap_or_try_on</hidden>, follow the skill decider instructions on how to deal with these payloads.'
workflow_id: accessories_shoot
use_case_id: jewellery_photoshoot
---

# Jewellery Photoshoot — Guidelines

This skill covers user requests for professional jewelry photography: rings, necklaces, earrings, watches. Clean shots that show sparkle and detail.

Example requests:
- "Create a jewellery photoshoot for this ring."
- "I need professional photos of this necklace."
- "Photograph this watch — clean shot showing detail and sparkle."

---
## Inputs

**Required:**
- **product_image** (string URL): Exactly one product image. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_image is missing, ask the user to provide via one of these options. Only one image is accepted; if the user provides multiple, pick the most relevant one or ask them to choose.

**Optional:**
- **reference_image** (string URL): One reference image for style or composition inspiration. User can provide via upload or URL. Only one image; omit if not provided.
- **custom_description** (string): Whatever the user specifically wants in the outputs (e.g. "dark background", "show sparkle", "minimalist"). Derive from the user's message; if they don't specify, use a short default like "User wants a jewellery photoshoot".

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
- **Reference image:** If the user provides one reference image (upload or URL), use it as **reference_image**. Only one image allowed.
- **custom_description:** Take from the user's message (e.g. "clean white background", "emphasize sparkle"). If nothing specified, use "User wants a jewellery photoshoot".

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_image** (and optionally reference_image, custom_description), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"accessories_shoot"`
- `use_case_id` = `"jewellery_photoshoot"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["product_image", "reference_image"] (or only the fields the user actually edited), "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"jpeg"`
  - **product_image** (string): Required. Single image URL.
  - **num_variations** (number): `4`
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **reference_image** (string): Optional. Single image URL. Omit if not provided.
  - **custom_description** (string): Optional. From user message or "User wants a jewellery photoshoot". Omit if not needed.

---
## Example execute_workflow call

When you have product_image (and optional reference_image, custom_description):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "accessories_shoot",
    "use_case_id": "jewellery_photoshoot",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_image", "reference_image"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "jpeg",
      "product_image": "https://example.com/ring.png",
      "num_variations": 4,
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "reference_image": "https://example.com/reference.png",
      "custom_description": "User wants a jewellery photoshoot"
    }
  }
}
```

Omit **reference_image** and **custom_description** if not provided. **product_image** and **reference_image** must each be a single URL string, not a list. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user asks for professional jewelry photography (rings, necklaces, earrings, watches) — clean shots showing sparkle and detail. Not for garment/product-on-model or general product shots; use the other space skills for those.
- When you have product_image (and optional reference_image, custom_description), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different product or style), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about jewellery/accessories photography, do **not** use this skill.
