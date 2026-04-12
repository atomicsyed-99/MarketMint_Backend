---
name: static-ad-creative
description: 'Use this to create single-image ads for Meta, Google, or display networks. Product + headline + CTA in one polished visual.'
workflow_id: social_static_ad
use_case_id: static_social_ad_creative
---

# Static Ad Creative — Guidelines

This skill covers user requests for single-image ad creatives (e.g. for Meta, Google, or display): product, headline, and CTA in one polished visual.

Example requests:
- "Create a static ad for this product for Meta."
- "I need a single-image ad for Google with headline and CTA."
- "Make a display ad creative with this product and our logo."

---
## Inputs

**Required:**
- **product_images** (list of URLs): Accepts **multiple** inputs — one or more product images. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If product_images are missing, ask the user to provide via one of these options.

**Optional:**
- **reference_images** (list of URLs): Accepts **multiple** inputs — images the user attaches for inspiration or to mimic (e.g. style references). Use if the user provides; omit otherwise.
- **model_image** (string URL): Model/face reference. Use if the user uploads or shares one; omit otherwise.
- **campaign_details** (string): Specific details the user mentions about the campaign (e.g. audience, tone, headline idea). Capture from the user's message; if they don't specify, use a short default like "Static ad creative".
- **brand_logo** (string URL): Brand logo. Use if the user uploads or provides one; omit otherwise.

**Fixed (defaults; use these unless the user specifies otherwise):**
- **textMessage**: `"Proceed"`
- **aspect_ratio**: `"1:1"`
- **include_text**: `true`
- **output_format**: `"jpeg"`
- **num_variations**: `4`
- **use_uploaded_face**: `true`
- **model_selection**: `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
- If the user specifies a different aspect_ratio, num_variations, or output_format, use the user's values in the execute_workflow call.

---
## How to obtain inputs

- **Product images:** User can provide via **upload**, **extract from URL**, or **search from web**. If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl`. Show results, get approval, then use approved URLs.
  - If they want to **search by description** (no URL) → use `searchImages`. Show results, get approval, then use chosen URL(s).
- **Reference images:** If the user says they want to mimic a style or provides reference images, collect via upload or URL and add to **reference_images**.
- **Model image:** If the user provides a model/face image (upload or URL), use it for **model_image**.
- **Campaign details:** Take from the user's message (e.g. "for summer sale", "headline: Get 20% off"). If nothing specified, use "Static ad creative".
- **Brand logo:** If the user uploads or provides a logo URL, use it for **brand_logo**.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **product_images** (and any optional inputs), call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"social_static_ad"`
- `use_case_id` = `"static_social_ad_creative"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["product_images", "reference_images", "brand_logo", "model_image"] (or only the fields the user actually edited), "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **brand_logo** (string URL): Optional. Omit if not provided.
  - **model_image** (string URL): Optional. Omit if not provided.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **include_text** (boolean): `true`
  - **output_format** (string): `"jpeg"`
  - **num_variations** (number): `4`
  - **product_images** (list of strings): Required. Accepts multiple inputs — one or more image URLs.
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **campaign_details** (string): Optional. From user message or "Static ad creative". Omit if not needed.
  - **reference_images** (list of strings): Optional. Accepts multiple inputs — one or more image URLs. Omit if not provided.
  - **use_uploaded_face** (boolean): `true`

---
## Example execute_workflow call

When you have product_images (and optional reference_images, model_image, campaign_details, brand_logo):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "social_static_ad",
    "use_case_id": "static_social_ad_creative",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["product_images", "reference_images", "brand_logo", "model_image"], "brandMemoryEnabled": true },
      "brand_logo": "https://example.com/logo.png",
      "model_image": "https://example.com/model.png",
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "include_text": true,
      "output_format": "jpeg",
      "num_variations": 4,
      "product_images": ["https://example.com/product.png"],
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "campaign_details": "Static ad creative",
      "reference_images": ["https://example.com/reference.png"],
      "use_uploaded_face": true
    }
  }
}
```

Omit optional keys (brand_logo, model_image, campaign_details, reference_images) if not provided. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user asks for single-image ad creatives for Meta, Google, or display (product + headline + CTA in one visual). Not for video ads or multi-image carousels; use other skills or creative-generation for those.
- When you have product_images (and any optional inputs), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different product, logo, or campaign details), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about static ad creatives for ads, do **not** use this skill.
