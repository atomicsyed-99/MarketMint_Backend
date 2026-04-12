---
name: feature-highlight-graphic
description: 'Use this to create focused visuals that spotlight one specific feature. Zoom in on the zipper. Highlight the USB-C port. Show off the adjustable strap.'
workflow_id: product_listing
use_case_id: feature_highlight_graphic
---

# Feature Highlight Graphic — Guidelines

This skill covers user requests for focused visuals that spotlight **one specific feature** of a product: zoom in on the zipper, highlight the USB-C port, show off the adjustable strap, etc.

Example requests:
- "Create a graphic that highlights just the zipper on this jacket."
- "I need a visual spotlighting the USB-C port."
- "Show off the adjustable strap on this bag."

---
## Inputs

**Required:**
- **product_image** (string URL): Exactly **one** product image. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_image is missing, ask the user to provide via one of these options. Only one image is accepted; if the user provides multiple, pick the most relevant one or ask them to choose.
- **key_features** (string): Mandatory. The specific feature(s) to spotlight (e.g. "zipper", "USB-C port", "adjustable strap"). Capture what the user wants to highlight. If the user has not mentioned anything specific, use a short summary of their basic requirement (e.g. "User wants to highlight the feature space" or "Key product feature") — this field is mandatory so always provide something.

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
- **key_features:** Take from the user's message (e.g. "highlight the zipper", "spotlight the USB-C port"). If they don't specify, use a short summary (e.g. "User wants to highlight the feature space" or "Key product feature") — this field is mandatory so always provide something.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_image** and **key_features**, call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"product_listing"`
- `use_case_id` = `"feature_highlight_graphic"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (all keys as below):

  - **_metadata** (dict): `{ "userEditedFields": ["product_image"] (or ["product_image", "key_features"] if user edited both), "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **key_features** (string): Required. What to spotlight (user's specific feature or a short summary of their requirement).
  - **output_format** (string): `"jpeg"`
  - **product_image** (string): Required. Single image URL only.
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
    "use_case_id": "feature_highlight_graphic",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_image"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "key_features": "User wants to highlight the feature space",
      "output_format": "jpeg",
      "product_image": "https://example.com/product.png",
      "num_variations": 4,
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }
    }
  }
}
```

**key_features** is mandatory — use the user's specific feature if they gave one, otherwise a short summary. **product_image** must be a single URL. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user asks for a **focused** visual that spotlights **one specific feature** (zipper, USB-C port, adjustable strap, etc.). Not for full infographics with multiple features/specs — use the Product Infographic skill for those. Not for plain product shots.
- When you have product_image and key_features, call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different product or feature to spotlight), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about feature-highlight graphics, do **not** use this skill.
