---
name: sketch-to-product
description: 'Use this to turn rough sketches or concepts into realistic product images. Design ideation. Prototype visualization. Concept to visual.'
workflow_id: sketch_to_product
use_case_id: sketch_to_product
---

# Sketch to Product — Guidelines

This skill covers user requests to **turn rough sketches or concepts into realistic product images**: design ideation, prototype visualization, concept to visual.

Example requests:
- "Turn this sketch into a realistic product image."
- "Convert my concept drawing to a photorealistic product."
- "Visualize this prototype as a finished product."

---
## Inputs

**Required:**
- **product_sketches** (list of URLs): Accepts **multiple** inputs — one or more sketch or concept images. The user can provide via **upload** or **extract from a URL** (if they give a link). If product_sketches are missing, ask the user to provide via one of these options.

**Optional:**
- **additional_images** (list of URLs): Accepts **multiple** inputs — extra images for reference or inspiration (e.g. style, material, color). The user may or may not attach these. Use if the user provides; omit otherwise.
- **custom_description** (string): Anything specific the user mentions for the output. Not mandatory; omit or leave empty if not specified.

**Fixed (defaults; use these unless the user specifies otherwise):**
- **textMessage**: `"Proceed"`
- **aspect_ratio**: `"1:1"`
- **output_format**: `"jpeg"`
- **num_variations**: `4`
- **model_selection**: `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
- If the user specifies a different aspect_ratio, num_variations, or output_format, use the user's values in the execute_workflow call.

---
## How to obtain inputs

- **Product sketches:** User can provide via **upload** or **extract from URL**. If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl`. Show results, get approval, then use approved URLs (multiple allowed for product_sketches).
- **Additional images:** If the user attaches extra reference or inspiration images (upload or URL), add them to **additional_images** (multiple allowed). Omit if not provided.
- **custom_description:** Take from the user's message. Omit or use empty string if not specified.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_sketches** (and optionally additional_images, custom_description), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"sketch_to_product"`
- `use_case_id` = `"sketch_to_product"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["product_sketches", "additional_images"] (or only the fields the user actually edited), "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"jpeg"`
  - **num_variations** (number): `4`
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **product_sketches** (list of strings): Required. Accepts multiple inputs — one or more sketch/concept image URLs.
  - **additional_images** (list of strings): Optional. Accepts multiple inputs — reference or inspiration image URLs. Omit if not provided.
  - **custom_description** (string): Optional. What the user wants specific in the outputs. Omit or use `""` if not specified.

---
## Example execute_workflow call

When you have product_sketches (and optional additional_images, custom_description):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "sketch_to_product",
    "use_case_id": "sketch_to_product",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_sketches", "additional_images"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "jpeg",
      "num_variations": 4,
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "product_sketches": ["https://example.com/sketch.png"],
      "additional_images": ["https://example.com/reference.png"],
      "custom_description": ""
    }
  }
}
```

Omit **additional_images** if not provided; **custom_description** can be omitted or `""`. **product_sketches** and **additional_images** both accept multiple image URLs. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user wants to **turn sketches or concept drawings into realistic product images** (design ideation, prototype visualization, concept to visual). Not for editing existing product photos or garment-on-model; use other space skills for those.
- When you have product_sketches (and any optional inputs), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different sketches or references), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about sketch-to-product / concept-to-visual, do **not** use this skill.
