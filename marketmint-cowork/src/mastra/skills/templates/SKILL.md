---
name: templates
description: 'Use when the user message contains a hidden block with workflow_id and use_case_id (e.g. from a template or space picker in the UI), with or without selected_template_prompt_id and attachments. The visible text is the user''s custom request; handle by matching to a space skill or falling back to creative generation.'
---

# Template / Space Selection — Guidelines

This skill handles messages where the user has selected a template or space from the UI. The message may contain:
- Visible text: the user's custom request (e.g. "Use this template to create my product visuals").
- A hidden block: `<hidden>workflow_id=..., use_case_id=..., selected_template_prompt_id=...</hidden>`.
- Attachments: images from the template or the user (in current_attachments / asset catalog).

---
## CRITICAL — Do not call execute_workflow until the space skill is loaded

When the message contains **workflow_id** and **use_case_id** in the hidden block, you **must** load the matching **space skill** before **execute_workflow**. Use **`skill_search`** with a short query that includes both ids (e.g. `generate_video template_video`, or `product_swap product_swap_or_try_on`), **or** call **`skill`** with the space skill’s **name** when you know it (e.g. `template-video`, `product-swap-or-try-on`). **Do not** call **execute_workflow** until you have read that skill’s full text. Use **only** the field names and rules from that space skill (e.g. **reference_image**, **product_image**, **custom_description** — not template_image or custom_instructions unless that skill explicitly uses those names). Never guess workflow_inputs keys; the loaded space skill defines them.

---
## Steps

1. **Parse the payload**  
   From the user message, extract from the `<hidden>...</hidden>` block (if present):
   - `workflow_id`
   - `use_case_id`
   - `template_id` (may be present for video templates; use for step 3 when workflow_id is generate_video)
   - `selected_template_prompt_id` (may be null)

2. **Fetch template prompt (if selected_template_prompt_id is non-null)**  
   Call **fetchTemplatePrompt** with that id to get the template prompt text from LangSmith. You will use this text together with the user's custom request (the visible part of the message before `<hidden>`) in the appropriate field below.

3. **product-swap-or-try-on use case but number of variations/outputs requested by user is more than 1**
   When the use_case_id is product-swap-or-try-on but the number of outputs requested by the user is more than 1, then you should directly invoke the creative generation skill taking along with you the prompt that you the template prompt text and the user's custom instructions to pass it as part of the directImageGen tool call whose instructions you will read in the creative generation skill.
   
3. **Match to a space skill (mandatory before execute_workflow or tool call)**  
   Use **skill_search** with keywords from step 1 (e.g. `product_swap product_swap_or_try_on`, or `generate_video template_video`), **or** call **skill** with the matching space skill name once identified.  
   - **Use_case_id for match:** Use the value from the hidden block from step 1 **except** when workflow_id is **generate_video** and **template_id** is present in the hidden block — in that case use **template_video** (the frontend may send use_case_id=undefined). So call: `match workflow_id generate_video use_case_id template_video`.  
   - The decider will return the single space skill whose workflow_id and use_case_id match.  
   - If a **space skill is returned**: You **must** use that skill's guidelines. If the skill says to call **execute_workflow**, build workflow_inputs with **only** the field names that skill specifies (e.g. product_image, reference_image, custom_description — do not use template_image or custom_instructions unless that skill says so). Map attachments to that skill's image fields (e.g. if the skill says "attachment with is_template_image → reference_image, other attachment → product_image", do that). Set that skill's custom-instructions field (user_query, custom_description, or additional_instructions per the skill doc) to: **template prompt text (if fetched) + "\n\n" + user's custom request (visible text before <hidden>)**. Then call **execute_workflow** with that skill's workflow_id, use_case_id, and the workflow_inputs you built. If the skill says to call a **different tool** (e.g. **singleStepVideoGenerator**), call that tool with the args the skill specifies — do not call execute_workflow.  
   - If **no** matching space skill: Fall back to **creative generation** (step 4).

4. **Fallback — Creative generation**  
   When no space skill matches the payload's workflow_id and use_case_id:
   - Use **directImageGen**.
   - Set **user_prompt** (or the main prompt field) to: **template prompt text (if you fetched it) + "\n\n" + user's custom request**.  
   - Pass any attachments as **asset_urls** (or **reference_images** if appropriate) per the creative-generation skill.

---
## Summary

- **Never** call execute_workflow for a template/space message until you have loaded the matching space skill via **skill_search** / **skill**. Use **only** that skill's field names in workflow_inputs.
- **selected_template_prompt_id non-null** → call **fetchTemplatePrompt(prompt_id)** first.
- **Match workflow_id + use_case_id** → load the space skill, then use its execute_workflow shape and field names; put template prompt + user request in that skill's custom-instructions field; map attachments per that skill.
- **No match** → **directImageGen** with **user_prompt** = template prompt + user request; pass attachments as asset_urls/reference_images.
