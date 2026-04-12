---
name: multiple-try-on
description: 'Use this to show multiple products worn together on a single model. Complete outfit styling. Full accessory stack. Head-to-toe looks.'
workflow_id: multi_product_visuals
use_case_id: multi_product_try_on
---

# Multiple Try-On — Guidelines

This skill covers user requests to show **multiple products worn together on a single model**: complete outfit styling, full accessory stack, head-to-toe looks.

Example requests:
- "Put all these items on one model — full outfit."
- "Show this shirt, jacket, and watch together on a model."
- "Create a head-to-toe look with these pieces."

---
## Inputs

**Required:**
- **product_images** (list of URLs): Accepts **multiple** inputs — one or more product/garment images to be worn together on a single model. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_images are missing, ask the user to provide via one of these options.

**Optional:**
- **reference_images** (list of URLs): Accepts **multiple** inputs — style or composition references the user attaches. Use if the user provides; omit otherwise.
- **custom_description** (string): Whatever the user wants specific in the outputs (e.g. "casual street style", "formal look"). Derive from the user's message; omit if not specified.

**Fixed (defaults; use these unless the user specifies otherwise):**
- **textMessage**: `"Proceed"`
- **aspect_ratio**: `"1:1"`
- **output_format**: `"jpeg"`
- **num_variations**: `4`
- **model_selection**: `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
- If the user specifies a different aspect_ratio, num_variations, or output_format, use the user's values in the execute_workflow call.

---
## How to obtain inputs

- **Product images:** User can provide via **upload**, **extract from URL**, or **search from web**. If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl`. Show results, get approval, then use approved URLs (multiple allowed).
  - If they want to **search by description** (no URL) → use `searchImages`. Show results, get approval, then use chosen URL(s).
- **Reference images:** If the user provides reference images (upload or URL), add them to **reference_images** (multiple allowed).
- **custom_description:** Take from the user's message (e.g. "street style", "minimalist"). Omit if not specified.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_images** (and optionally reference_images, custom_description), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"multi_product_visuals"`
- `use_case_id` = `"multi_product_try_on"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["product_images", "reference_images"] (or only the fields the user actually edited), "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"jpeg"`
  - **num_variations** (number): `4`
  - **product_images** (list of strings): Required. Accepts multiple inputs — one or more image URLs.
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **reference_images** (list of strings): Optional. Accepts multiple inputs — one or more image URLs. Omit if not provided.
  - **custom_description** (string): Optional. What the user wants specific in the outputs. Omit if not specified.

---
## Example execute_workflow call

When you have product_images (and optional reference_images, custom_description):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "multi_product_visuals",
    "use_case_id": "multi_product_try_on",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_images", "reference_images"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "jpeg",
      "num_variations": 4,
      "product_images": ["https://example.com/shirt.png", "https://example.com/jacket.png"],
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "reference_images": ["https://example.com/reference.png"],
      "custom_description": "User wants multiple try-on looks"
    }
  }
}
```

Omit **reference_images** and **custom_description** if not provided. **product_images** and **reference_images** both accept multiple image URLs. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user wants **multiple products worn together on one model** — complete outfit, accessory stack, head-to-toe look. Not for a single garment on model (use garment lifestyle/studio skills) or for non-garment product shots; use the matching space skills for those.
- When you have product_images (and any optional inputs), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different pieces or style), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about multiple try-on / outfit styling on one model, do **not** use this skill.
