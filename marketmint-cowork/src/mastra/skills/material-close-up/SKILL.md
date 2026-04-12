---
name: material-close-up
description: 'Use this to show fabric texture, material quality, or surface detail. Zoom in on the leather grain. The knit pattern. The brushed metal finish.'
workflow_id: product_closeup
use_case_id: fabric_material_close_up
---

# Material Close-up — Guidelines

This skill covers user requests for close-up shots that highlight fabric texture, material quality, or surface detail of a product.

Example requests:
- "Show the texture of this fabric close-up."
- "I want to highlight the leather grain on this bag."
- "Zoom in on the knit pattern of this sweater."
- "Close-up of the brushed metal finish on this product."

---
## Inputs

**Required:**
- **product_images** (list of URLs): Accepts **multiple** inputs — one or more product images. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_images are missing, ask the user to provide via one of these options.

**Optional (fill from user message):**
- **area_to_focus** (string): What the user wants to focus on (e.g. "material close-up", "fabric texture", "leather grain", "knit pattern", "brushed metal finish"). Derive from the user's words; if they don't specify, use a short summary like "User wants to focus on material close-up".

**Fixed (defaults; use these unless the user specifies otherwise):**
- **aspect_ratio**: `"1:1"`
- **output_format**: `"jpeg"`
- **num_variations**: `4`
- If the user specifies a different aspect_ratio, num_variations, or output_format, use the user's values in the execute_workflow call.

---
## How to obtain inputs

- **Product images:** User can provide via **upload**, **extract from URL**, or **search from web**. If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl`. Show results, get approval, then use approved URLs.
  - If they want to **search by description** (no URL) → use `searchImages`. Show results, get approval, then use chosen URL(s).
- **area_to_focus:** Take from the user's message (e.g. "focus on leather grain" → "User wants to focus on leather grain"; if vague, use "User wants to focus on material close-up").

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_images** (and optionally area_to_focus), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"product_closeup"`
- `use_case_id` = `"fabric_material_close_up"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (all keys as below; omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["product_images"], "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **area_to_focus** (string): Optional. From user message (e.g. "User wants to focus on material close-up" or "leather grain", "knit pattern"). Omit or use a short summary if user didn't specify.
  - **output_format** (string): `"jpeg"`
  - **num_variations** (number): `4`
  - **product_images** (list of strings): Required. Accepts multiple inputs — one or more image URLs.
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`

---
## Example execute_workflow call

When you have product_images (and optional area_to_focus):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "product_closeup",
    "use_case_id": "fabric_material_close_up",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_images"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "area_to_focus": "User wants to focus on material close-up",
      "output_format": "jpeg",
      "num_variations": 4,
      "product_images": ["https://example.com/product.png"],
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }
    }
  }
}
```

Omit **area_to_focus** if not specified by user, or set to a short summary. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user asks for close-up shots of fabric texture, material quality, or surface detail (leather grain, knit pattern, brushed metal, etc.). Not for general product shots or model-on-product; use garment/non-garment lifestyle/studio skills for those.
- When you have product_images (and optional area_to_focus), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different product or focus area), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about material/fabric/surface close-up, do **not** use this skill.
