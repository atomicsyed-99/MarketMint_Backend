---
name: product-swap-or-try-on
description: 'Use when the user wants to swap a product onto a reference (e.g. put one product on a model/reference image, try a product on a reference). Requires exactly one product image and one reference image. Not for multiple try-on or outfit styling—use multiple-try-on for that. If the number of variations/outputs requested by the user you should use the creative-generation skill. DO NOT USE THIS.'
workflow_id: product_swap
use_case_id: product_swap_or_try_on
---

# Product Swap / Try-On — Guidelines

This skill covers user requests to **swap a single product onto a reference image** (e.g. try this product on this model/reference, put this garment on this person, swap product onto reference). It requires **exactly one product image** and **exactly one reference image**.

Example requests:
- "Put this shirt on this model."
- "Try this product on this reference image."
- "Swap this garment onto this person."
- "Show how this would look on this model."

---
## Inputs

**Required (each accepts a single image URL only):**
- **product_image** (string URL): Exactly **one** product/garment image URL. The user can provide via **upload**, **extract from a URL**, or **search from the web**. If missing, ask the user to provide via one of these options.
- **reference_image** (string URL): Exactly **one** reference image URL (e.g. model, person, mannequin). Same options as product_image. If missing, ask the user to provide.

**Optional (but always include in workflow_inputs):**
- **custom_description** (string): Any extra description or style the user wants. **Always include this key** in workflow_inputs: use the user's text when they specified something (e.g. "casual style", "focus on the collar"); use `""` when they didn't specify anything. Do not omit the key — the workflow expects it.
- **aspect_ratio** (string): e.g. `"1:1"`. Default `"1:1"` unless the user specifies otherwise.
- **output_format** (string): e.g. `"png"` or `"jpeg"`. Default `"png"` unless the user specifies otherwise.
- **num_variations** (number): Number of output variations. Default `2` unless the user specifies otherwise.

**Fixed (defaults; use these unless the user specifies otherwise):**
- **textMessage**: `"Proceed"`
- **model_selection**: `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
- **_metadata**: `{ "userEditedFields": ["product_image", "reference_image", "num_variations", "output_format", "aspect_ratio"], "brandMemoryEnabled": true }`

---
## Template attachments (current_attachments with is_template_image)

When the user has **attachments** in the same message (e.g. from a shared template or remix):

- **If any attachment has `is_template_image: true`** → that attachment is the **reference image** (the template), **not** the product image. Use its `url` as **reference_image**. Do **not** ask the user to upload or provide the template/reference image in this case.
- **The other attached image(s)** in the same message are the **product image(s)** unless the user explicitly says otherwise. If there is exactly one non-template image, use its `url` as **product_image**.
- Only ask for a template/reference image when there is **no** attachment with `is_template_image: true` and you do not already have a reference_image from context.

**Example:** User attaches (1) a template image with `is_template_image: true` and (2) a jewellery image, and says "Use this template to create my product visuals" or "Swap this jewellery onto the template." → Set **reference_image** = URL of the attachment with `is_template_image: true`, **product_image** = URL of the other attachment. Then call **execute_workflow** with these two URLs. Do **not** ask "where is the template image?" — you already have it.

---
## How to obtain inputs

- **Product image:** User can provide via **upload**, **extract from URL**, or **search from web**. Must be **one** image. If missing, ask which option they want to use.
  - If they give a **URL** → use `extractImagesFromUrl` or accept the URL; pick **one** image for product_image.
  - If they want to **search by description** → use `searchImages`; show results, get approval, then use **one** chosen URL for product_image.
  - **If they attached multiple images and one has `is_template_image: true`** → the non-template attachment is the product_image (see "Template attachments" above).
- **Reference image:** Same as product image — **one** image only. If missing, ask the user to provide one reference (model/person) image — **unless** an attachment has `is_template_image: true`, in which case use that as reference_image and do not ask.
- **custom_description:** Take from the user's message when they specified something (e.g. style, placement). When they didn't specify anything, use `""`. **Always include custom_description in workflow_inputs** — never omit the key.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Pre-execution rule

**Do not call execute_workflow until you have both:**
- one **product_image** URL, and  
- one **reference_image** URL  

(e.g. from current_attachments, including using an attachment with `is_template_image: true` as reference_image). If either is missing, ask the user for it and do **not** execute.

---
## Execution

When you have **product_image** and **reference_image** (each a single URL), call **execute_workflow** directly. Do not call collect_workflow_inputs. Only call execute_workflow when both are present; otherwise ask for the missing one.

**execute_workflow** arguments:
- `workflow_id` = `"product_swap"`
- `use_case_id` = `"product_swap_or_try_on"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit other optional keys if not available; **custom_description must always be present**):

  - **_metadata** (dict): `{ "userEditedFields": ["product_image", "reference_image", "num_variations", "output_format", "aspect_ratio"], "brandMemoryEnabled": true }`
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"png"`
  - **num_variations** (number): `1`
  - **product_image** (string): Required. **Single** image URL — not a list.
  - **reference_image** (string): Required. **Single** image URL — not a list.
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **custom_description** (string): **Required key.** Use the user's text when they specified something (e.g. style, placement); use `""` when they didn't. Never omit this key.

---
## Example execute_workflow call

When you have product_image and reference_image (each a single URL):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "product_swap",
    "use_case_id": "product_swap_or_try_on",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_image", "reference_image", "num_variations", "output_format", "aspect_ratio"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "png",
      "num_variations": 1,
      "product_image": "https://dev.cdn.pro.corp.marketmint.ai/product.png",
      "reference_image": "https://dev.cdn.pro.corp.marketmint.ai/reference.png",
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "custom_description": ""
    }
  }
}
```

**product_image** and **reference_image** must be **single URL strings**, not arrays. **custom_description** must always be present in workflow_inputs (use `""` when the user didn't specify anything). **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user wants to **swap one product onto one reference** (e.g. try this product on this model, put this garment on this person). Not for multiple products on one model (use multiple-try-on) or for single-garment lifestyle/studio (use garment-in-lifestyle-settings or garment-in-studio-settings).
- When you have product_image and reference_image (each one URL), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- **Never ask for the template or reference image** when the user's attachments include one with `is_template_image: true` — that attachment is the reference. Use it and the other attached image, then run execute_workflow.
- If the user refines (e.g. different product or reference), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about swapping one product onto one reference, do **not** use this skill.
