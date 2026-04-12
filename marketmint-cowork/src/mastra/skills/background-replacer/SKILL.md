---
name: background-replacer
description: 'Use this to swap your product background for something new. White studio. Lifestyle scene. Solid color. Gradient. Anything.'
workflow_id: imageEdit
use_case_id: replace_background
---

# Background Replacer — Guidelines

This skill covers user requests to **swap the product background** for something new: white studio, lifestyle scene, solid color, gradient, or anything else.

Example requests:
- "Replace the background of this product with a white studio."
- "Put this product on a lifestyle background."
- "Swap the background to a solid blue / gradient."

---
## Inputs

**Required:**
- **product_image** (string URL): Exactly **one** product image. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_image is missing, ask the user to provide via one of these options. Only one image is accepted; if the user provides multiple, pick the most relevant one or ask them to choose.

**Optional:**
- **background_image** (string URL): Exactly **one** background reference image. The user may optionally upload or provide a URL for the new background. Only one image; omit if not provided.
- **custom_description** (string): Anything specific the user mentions (e.g. "white studio", "lifestyle scene", "solid color", "gradient"). Not mandatory; omit if not specified.

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
- **Background image:** If the user uploads or provides a background reference (one image), use it as **background_image**. Only one image allowed; omit if not provided.
- **custom_description:** Take from the user's message (e.g. "white studio", "lifestyle scene"). Omit if not specified.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_image** (and optionally background_image, custom_description), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"imageEdit"`
- `use_case_id` = `"replace_background"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["product_image", "background_image"] (or only the fields the user actually edited), "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"jpeg"`
  - **product_image** (string): Required. Single image URL only.
  - **num_variations** (number): `4`
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **background_image** (string): Optional. Single image URL only. Omit if not provided.
  - **custom_description** (string): Optional. What the user wants specific (e.g. "User wants a background replacer"). Omit if not specified.

---
## Example execute_workflow call

When you have product_image (and optional background_image, custom_description):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "imageEdit",
    "use_case_id": "replace_background",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_image", "background_image"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "jpeg",
      "product_image": "https://example.com/product.png",
      "num_variations": 4,
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "background_image": "https://example.com/background.png",
      "custom_description": "User wants a background replacer"
    }
  }
}
```

Omit **background_image** and **custom_description** if not provided. **product_image** and **background_image** must each be a single URL string. **workflow_inputs** must be a dict.

---
## Selected image + attached image

- When the user has **selected a specific image** (e.g. one of the generated outputs) and **attached another image** in the same message and asks to replace the background of "this one" with the attached image: **product_image** = the **selected** image (the one to edit). **background_image** = the **attached** image (the new background). Do **not** use any other image from the conversation (e.g. the original from a previous replace-background run) as product_image. Use only the image the user selected and the image they attached.

---
## Behavioral guidelines

- **When to use this skill:** When the user wants to **replace or swap the background** of a product image (white studio, lifestyle scene, solid color, gradient, etc.). Not for full creative generation or garment-on-model; use other space skills for those.
- When you have product_image (and optional background_image, custom_description), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user has **selected** one image and **attached** another for the new background, use the selected image as product_image and the attached as background_image; never substitute another image from history.
- If the user refines (e.g. different product or background), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about background replacement, do **not** use this skill.
