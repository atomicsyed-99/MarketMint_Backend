---
name: template-video
description: 'Use when the user message contains a template-video payload: hidden block with workflow_id=generate_video and template_id (UUID), plus attachments with a template video (is_template_image true) and a product image. Call singleStepVideoGenerator with template_id, product_image_url, and user_text.'
workflow_id: generate_video
use_case_id: template_video
---

# Template Video — Guidelines

This skill handles **template payloads for videos**: the user has selected a **video template** from the UI and attached a **product image**. The message contains:

- A **hidden block**: `<hidden>workflow_id=generate_video, template_id=<UUID>, selected_template_prompt_id=...</hidden>` (use_case_id in the block may be undefined; use **template_video** for the match call).
- **Attachments** (in current_attachments):
  - One with `is_template_image: true` and `type: "video"` (the template video reference — do **not** use this as product_image_url).
  - One product image (e.g. `type: "image/png"`) — use its URL as **product_image_url**.

---
## CRITICAL — Call singleStepVideoGenerator with the correct args

You **must** call **singleStepVideoGenerator** with **only** these field names and values from the user message. Do **not** call execute_workflow for this skill.

**User-facing copy:** Do **not** explain to the user which skill you followed, which tool you are calling, or list \`template_id\` / \`product_image_url\` in prose before the tool runs. Say at most one short friendly line if needed, then call the tool; arguments belong **only** in the tool JSON.

---
## Inputs

**Required:**
- **template_id** (string): UUID of the template. Get from the `<hidden>...</hidden>` block: parse the part `template_id=<UUID>` (e.g. `template_id=0e6a6be6-c415-434a-a03c-922a481ac255`). If the block has `template_id=undefined` or missing, do not call the tool; ask the user or fall back.
- **product_image_url** (string): URL of the product image. Get from **current_attachments**: the attachment where **is_template_image is not true** (the other attachment is the template video). If there are multiple non-template attachments, use the first one that looks like a product image (e.g. type image/png, or tag=product_image).

**Optional (but include when available):**
- **user_text** (string): The user's visible request. Get the visible part of the message **before** `<hidden>` (e.g. "Use this template to create my product visuals" or "generate a video for the attached jewellery in accordance with the video template attached"). Use empty string if none.

---
## Template attachments (current_attachments)

- **If any attachment has `is_template_image: true`** → that attachment is the **template video** (reference). Do **not** use its URL as product_image_url.
- **The other attached image** in the same message is the **product image**. Use its `url` as **product_image_url**.
- Only call the tool when you have both **template_id** (from hidden block) and **product_image_url** (from the non-template attachment).

---
## Steps

1. **Parse the hidden block**  
   From the user message, extract from `<hidden>...</hidden>`:
   - **template_id** (required; skip if undefined or missing).
   - workflow_id, use_case_id (you already matched so this skill was loaded).

2. **Get product_image_url**  
   From **current_attachments**: pick the attachment where **is_template_image is not true**. Use its `url` as **product_image_url**. If none, do not call the tool; ask for the product image.

3. **Get user_text**  
   Visible text before `<hidden>` (e.g. the part before " <hidden>workflow_id=..."). Use `""` if empty.

4. **Call singleStepVideoGenerator**  
   Call **singleStepVideoGenerator** with:
   - **template_id**: from step 1.
   - **product_image_url**: from step 2.
   - **user_text**: from step 3 (optional; can omit or pass empty string).

   Do **not** call execute_workflow. Do **not** call collect_workflow_inputs. This skill uses **singleStepVideoGenerator** only.

---
## Summary

- **When used:** Message has workflow_id=generate_video, template_id in hidden block, and attachments = template video + product image.
- **Action:** Call **singleStepVideoGenerator**(template_id, product_image_url, user_text). Map attachments: is_template_image=true → template video (ignore for product_image_url); other attachment → product_image_url.
- **No** execute_workflow or collect_workflow_inputs for this skill.
