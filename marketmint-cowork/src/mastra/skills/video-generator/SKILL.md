---
name: video-generator
description: 'Professional AI video production workflow. Use when the user wants to create product videos, commercials, short films, or full video content with a structured process—not when they only want to turn existing images into a video (use creative-video-generation for that).'
---

# Video Generator — Guidelines

Use this skill when the user wants **full video production**: product videos, commercials, short films, or any video created through a structured workflow. Do **not** use this for "turn these images into a video" or "create a video from these assets" — use **creative-video-generation** for that.

---

## Workflow Overview

1. **Phase 1: Initial** → Gather requirements, STOP for user confirmation.
2. **Phase 2: Global Definitions** → Define style, duration, aspect ratio (text only).
3. **Execution** → When user has confirmed and has a product/hero image, use the video generation tool.

---

## Critical Rules

1. **[PHASE 1 STOP]** Ask questions to gather information. Do not assume missing details. Summarize and wait for explicit user confirmation before proceeding.
2. **[DURATION]** Video length is **1–15 seconds** per clip (Grok Imagine Video limit). Use values in this range (e.g. 5s, 10s, 15s).
3. **[ASPECT RATIO]** Allowed: **1:1**, **16:9**, **9:16**, **4:3**, **3:4**, **3:2**, **2:3**. Default 16:9 if not specified.
4. **[RESOLUTION]** 480p (faster, default) or 720p (HD). Use 720p only when the user explicitly wants HD.
5. **[PRODUCT IMAGE REQUIRED]** Before running video generation, the user must provide a product/hero image (upload or URL). If they have not, ask for it.
---

## Phase 1: Gather Information

Use these dimensions to guide your questions:

| Dimension | Key Questions |
|-----------|----------------|
| **Strategy & Audience** | Who is this for? What's the goal? |
| **Narrative & Structure** | What's the story? Key moments? |
| **Visual Style** | What look and feel? Reference style? |
| **Duration** | How long? **(1–15 seconds per clip;** e.g. 5s, 10s, 15s.) |
| **Aspect ratio** | Portrait (9:16), landscape (16:9), square (1:1), or other (4:3, 3:4, 3:2, 2:3)? |
| **Shot Execution** | Product hero shots? Specific shots or angles? (Multiple angles = multiple videos.) |
| **Sound** | Voiceover? Music mood? |

**Gather at least:** purpose, **duration (1–15 seconds; default 5s for speed)**, **aspect ratio** (from allowed set), visual style, and whether they have a product image and optional moodboard/reference image.

> **[MANDATORY]** Summarize what you understood and wait for user confirmation before proceeding.

---

## Phase 2: Global Definitions (Brief)

- **Visual style**: Sub-genre or aesthetic (e.g. minimal, cinematic, anime).
- **Duration**: **1–15 seconds** per video (platform limit). e.g. 5s, 10s, or 15s.
- **Aspect ratio**: One of 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3.
- **Resolution**: 480p (default, faster) or 720p (HD).

---

## Image Tools (When You Need to Generate or Edit Images)

| In this skill | Use this tool |
|---------------|----------------|
| Create new images (with or without references) | **directImageGen** |
| Edit existing images / variations | **regenerate_image** |

- **directImageGen**: `user_prompt`, `asset_urls` (main subject URLs), `reference_images` (style/reference), `aspect_ratio` (for video keyframes use one of: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3), `num_variations`.
- **regenerate_image**: Use when the user wants to change an existing image (e.g. different pose, lighting); pass the image URL and edit instructions.

---

## Execution: Running Video Generation

When **all** of the following are true:

- User has **confirmed** the plan (Phase 1 summary and Phase 2 definitions).
- User has provided a **product/hero image** (uploaded or via URL).

Then run the **video generation** step:

### Single-shot option (when available): **generateVideoSingleShot**

Use when the user wants a **quick single video** (e.g. "make a 10s product ad", "one short clip") and you have their request and (optionally) attached images. This path uses **brand memory** and **Grok Imagine Video** (xAI). Limits: **duration 1–15 seconds**, aspect ratio from the allowed set, resolution 480p or 720p.

1. Call **generateVideoSingleShot** with:
   - **user_request**: The user's video request or short summary (purpose, style, duration).
   - **attachment_urls**: Optional list of image URLs (product/hero, moodboard); if omitted, the tool uses current_attachments from context.
   - **duration**: Optional. Integer 1–15 (seconds). Default 5 for fastest generation; pass 10 or 15 if user wants longer.
   - **aspect_ratio**: Optional. One of "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3". Default "16:9".
   - **resolution**: Optional. "480p" (default, faster) or "720p" (HD). Omit for fastest generation.
2. The tool streams progress (e.g. "Applying brand memory", "Generating video...") and **runs until the video is ready** (may take a few minutes). You get back JSON with `status: "completed"` and **video_url** when done. Present the video to the user.
3. If the user wants **multiple videos** (e.g. 10 different angles), call the tool once per variation (or with a summary that implies multiple angles); each call generates one video. You can run multiple calls in sequence and present all results.

### If the tool **generate_video** is available (full pipeline)

Call **generate_video** with:

- **user_message**: The user's video request or a short summary (purpose, style, duration).
- **product_image_url**: URL of the product/hero image (required).
- **moodboard_image_url**: URL of the moodboard/reference image if the user provided one; otherwise omit or pass null.
- **template_id**: Only if the user or context specified a template; otherwise omit.

Do not call any other tool for the actual video generation. The generate_video tool will hand off to the full video production pipeline (script concepts, image generation, clip generation, stitching).

### If the tool **generate_video** is not available

Then the user must provide **input images** for the video. Guide them to upload or provide image URLs. Once you have **input_images** (list of image URLs), call **execute_workflow** with:

- `workflow_id` = `"video"`
- `use_case_id` = `"creative_video_generator"`
- `acknowledgement` = `""` or a short acknowledgement
- `workflow_inputs` = a dict with:
  - `_metadata`: `{ "userEditedFields": ["input_images"], "brandMemoryEnabled": true }`
  - `textMessage`: `"Proceed"`
  - `input_images`: list of image URL strings
  - `model_selection`: `{ "model": { "name": "kling-video/v2.5-turbo/pro/image-to-video", "title": "Ultra", "output_type": "video" }, "step_id": 1 }`

---

## Behavioral Summary

- **When to use this skill:** User wants to create a **product video**, **commercial**, **short film**, or **full video production** with a structured process. They may or may not have images yet.
- **When NOT to use:** User already has images and only wants to "turn these into a video" or "make a video from these assets" → use **creative-video-generation** instead.
- Always complete Phase 1 (gather + confirm) before asking for or using the product image and running video generation.
- Use **directImageGen** and **regenerate_image** only if you need to generate or edit images as part of the conversation; the main video output is produced by **generate_video** or **execute_workflow** as above.