---
name: garment-in-studio-settings
description: Use only when the user explicitly asks for garment-on-model in a studio or indoor setting (e.g. "studio background", "indoor", "clean backdrop", "catalog shot"). Do not use this skill for generic image generation requests involving garments. If the user has mentioned that they want to put a garment on a model without specifying the type of background they want to use (lifestyle/outdoor or indoor/studio), you should first clarify with the user about their background preference. Once the user clarifies their background preference and prefers a studio background then you can select this skill. Do not use for generic image generation requests involving garments like "marketing images for this garment".
workflow_id: garments_v2
use_case_id: garments_v2_studio
---

# Garment in Studio — Guidelines

This skill covers user requests for putting garments on models in studio (indoor) settings.

Example requests:
- "Put this dress on a model in a studio scene"
- "Try this jacket on a model in an indoor setting"

---
## Inputs

**Required:**
- **garment_images** (list of URLs): At least one garment image. The user can provide only via: **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). There is no "describe" option for garment images. If garment_images are missing, ask the user to provide via one of these three options.

**Optional:**
- **model_image** (string URL): Model reference. If the user has already shared one (upload, URL, or from a prior tool result), use it. Do not ask for it if not provided.
- **background_image** (string URL): Background reference. Same as model_image — use if already shared; do not ask if not provided.
- **user_query** (string): Natural-language summary of what the user wants. Include any brand styles/themes if the user confirmed them after brand analysis.

---
## How to obtain inputs

- **Garment images:** User can provide via **upload**, **extract from URL**, or **search from web** only (no describe). If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl` (`url`, optional `query`, `max_images`). Show results, get approval, then use approved URLs.
  - If they want to **search by description** (no URL) → use `searchImages` (`description`, optional `max_results`). Show results, get approval, then use chosen URL(s).
- **Model / background:** Same tools if the user asks to get them (URL or search). If the user has not provided and has not asked, do not prompt — use from conversation if already shared.
- **Brand analysis:** If the user wants to use a brand's styles/themes, call `analyzeBrand` (with `url` or `query`), show results, ask which themes to use, then merge into **user_query**.
- **Trends:** If the user wants latest trends, use `tavilySearch`, show results, get approval, incorporate into **user_query** if relevant.

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **garment_images** (and optionally model_image, background_image, user_query), call **execute_workflow** directly. Do not call collect_workflow_inputs. Use the following payload shape.

**execute_workflow** arguments:
- `workflow_id` = `"garments_v2"`
- `use_case_id` = `"garments_v2_studio"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with (all keys as below; omit optional keys if not available):

  - **_metadata** (dict): `{ "userEditedFields": ["background_image", "poses"], "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **user_query** (string): User's request; include model/background description if they gave it.
  - **model_image** (string URL): Optional. Omit if not provided.
  - **textMessage** (string): `"Proceed"`
  - **aspect_ratio** (string): `"1:1"`
  - **output_format** (string): `"png"`
  - **garment_images** (list of strings): Required. One or more image URLs.
  - **model_selection** (dict): `{ "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 }`
  - **background_image** (string URL): Optional. Omit if not provided.

---
## Example execute_workflow call

When you have garment_images (and optional model_image, background_image, user_query):

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "garments_v2",
    "use_case_id": "garments_v2_studio",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["background_image", "poses"], "brandMemoryEnabled": true },
      "user_query": "Put this dress on a model in a studio with clean white backdrop.",
      "model_image": "https://example.com/model.png",
      "textMessage": "Proceed",
      "aspect_ratio": "1:1",
      "output_format": "png",
      "garment_images": ["https://example.com/garment.png"],
      "model_selection": { "model": { "name": "gemini-3.1-flash-image-preview", "title": "Pro", "output_type": "image" }, "step_id": 1 },
      "background_image": "https://example.com/background.png"
    }
  }
}
```

Omit optional keys (e.g. model_image, background_image) if not provided. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** Only when the user has clearly asked for garment-on-model in a **studio or indoor** setting (e.g. studio background, indoor, clean backdrop, catalog shot). If they said only "put this garment on a model" without specifying lifestyle vs studio, ask whether they want lifestyle/outdoor or indoor/studio first; load only the matching skill after they confirm.
- When you have garment_images (and optional others), call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different garment or background), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about a model wearing a garment in a studio setting, do **not** use this skill.
