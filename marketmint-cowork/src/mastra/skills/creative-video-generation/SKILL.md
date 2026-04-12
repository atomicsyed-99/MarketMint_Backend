---
name: creative-video-generation
description: 'Use this to create concept-driven video content. Transitions, effects, storytelling. Beyond simple product videos into creative territory.'
workflow_id: video
use_case_id: creative_video_generator
---

# Creative Video Generation — Guidelines

This skill covers user requests for **concept-driven video content**: transitions, effects, storytelling — beyond simple product videos into creative territory.

Example requests:
- "Create a video from these images with transitions and effects."
- "Turn these into a concept-driven video with storytelling."
- "Make a creative video with these assets."

---
## Inputs

**Required:**
- **input_images** (list of URLs): Accepts **multiple** inputs — one or more images to use as the basis for the video. The user can provide via **upload**, **extract from a URL** (if they give a link), or **search from the web** (by description). If input_images are missing, ask the user to provide via one of these options.

**Fixed (use these values):**
- **_metadata** (dict): `{ "userEditedFields": ["input_images"], "brandMemoryEnabled": true }`
- **textMessage** (string): `"Proceed"`
- **model_selection** (dict): `{ "model": { "name": "kling-2.5-turbo-pro", "title": "Ultra", "output_type": "video" }, "step_id": 1 }`

---
## How to obtain inputs

- **Input images:** User can provide via **upload**, **extract from URL**, or **search from web**. If missing, ask which of these they want to use.
  - If they give a **URL** to scrape → use `extractImagesFromUrl`. Show results, get approval, then use approved URLs (multiple allowed).
  - If they want to **search by description** (no URL) → use `searchImages`. Show results, get approval, then use chosen URL(s).

Execute one tool per response. After a tool runs, show results and get approval before using those values in the next step.

---
## Execution

When you have **input_images**, call **execute_workflow** directly. Do not call collect_workflow_inputs.

**execute_workflow** arguments:
- `workflow_id` = `"video"`
- `use_case_id` = `"creative_video_generator"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with:

  - **_metadata** (dict): `{ "userEditedFields": ["input_images"], "brandMemoryEnabled": true }` — brandMemoryEnabled must always be true.
  - **textMessage** (string): `"Proceed"`
  - **input_images** (list of strings): Required. Accepts multiple inputs — one or more image URLs.
  - **model_selection** (dict): `{ "model": { "name": "kling-2.5-turbo-pro", "title": "Ultra", "output_type": "video" }, "step_id": 1 }`

---
## Example execute_workflow call

When you have input_images:

```jsonc
{
  "name": "execute_workflow",
  "arguments": {
    "workflow_id": "video",
    "use_case_id": "creative_video_generator",
    "acknowledgement": "",
    "workflow_inputs": {
      "_metadata": { "userEditedFields": ["input_images"], "brandMemoryEnabled": true },
      "textMessage": "Proceed",
      "input_images": ["https://example.com/image1.png", "https://example.com/image2.png"],
      "model_selection": { "model": { "name": "kling-2.5-turbo-pro", "title": "Ultra", "output_type": "video" }, "step_id": 1 }
    }
  }
}
```

**input_images** accepts multiple image URLs. **workflow_inputs** must be a dict.

---
## Behavioral guidelines

- **When to use this skill:** When the user wants **concept-driven video content** — transitions, effects, storytelling, creative video from images. Not for simple image generation or image editing; use other space skills for those.
- When you have input_images, call **execute_workflow** directly with the payload above. Do not show a plan or call collect_workflow_inputs for this skill.
- If the user refines (e.g. different images), gather the updated inputs and call **execute_workflow** again with the new workflow_inputs.
- If the request is not about creative video generation from images, do **not** use this skill.
