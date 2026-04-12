---
name: creative-director
description: 'Use when the user wants strategic creative directions (e.g. 8 options or a creative deck) for a brand/product/brief, or when the image-generation request is highly complex, detailed, and high-intent (campaign, channel-specific, brand-heavy).'
---

# Creative Director — High-Intent Image Generation

Use this skill when:
- The user asks explicitly for **creative directions**, **options first**, **8 options**, or a **creative deck** for a product or brand.
- The user provides a **rich brief** (brand + product + clear objective + channels) and wants **specific images for a specific cause** (e.g. campaign, launch, hero + PDP + social).
- The request is clearly **more than “just generate a few images”** and needs strategic thinking.

Do **not** use for:
- Simple edits (background removal, color tweak, object add/remove) → use IMAGE_EDITING or other image workflows.
- Generic quick generations like “generate images of a horse” → use creative-generation instead.

---

## Overall Protocol (single run)

You are orchestrating a **single Creative Director session**. Follow these steps in order. Do not wait for user confirmation between steps unless explicitly stated.

### Step 0 — Collect core inputs (only if missing)

You need at least:
- **Product**: what it is (and image URL if provided).
- **Brand**: name or short description (and website if given).
- **Brief / Objective**: what they want (campaign, listing, launch, etc.).
- **Channels**: Instagram, PDP, website hero, print, etc.

If any of these are missing, ask **one concise clarification message** (no more than 3 bullet points). If they are already present, skip questions and continue.

### Step 1 — Brand context (no separate report tool)

Use the **user brief**, conversation, and any brand hints already in thread. For **image generation**, `directImageGen` applies saved **workspace brand memory** server-side (palette, voice, assets) — you do not call a standalone brand-report tool first.

If the brief omits obvious brand basics and the user has not provided them, ask **one** short clarification or proceed from what you have.

### Step 2 — Optional web search for gaps

If the brief or brand context has obvious gaps (e.g. “new category we don’t recognise”, “they explicitly ask for market/context trends”), you may call `tavilySearch` **once** to gather extra inspiration. Use it sparingly and keep it supplementary — **user brief and saved workspace memory (via tools) are primary**.

### Step 3 — Brief Analysis (streamed)

Immediately after Step 1 (and Step 2 if you used it), stream a **Brief Analysis** section to the user in plain text. Do not wait for their reply before continuing.

Structure:
- **Brand**: 2–3 bullets (who they are, archetype, tone, colors).
- **Product**: 2–3 bullets (category, key features, target audience).
- **Objective**: 2–3 bullets (campaign goal, funnel stage if obvious).
- **Channels**: 1–2 bullets (key constraints and aspect-ratio notes).

Then add one short line:  
“Based on this, I’ll craft 8 creative directions and show you one preview image for each.”

### Step 4 — Select 4 storytelling techniques (for D5–D8)

You must use the tool **`select_storytelling_techniques`** to pick the 4 storytelling techniques for directions D5–D8:
- Build:
  - `brand_summary`: 3–5 sentences summarising the brand (tone, archetype, visuals) from the brief and conversation (generation tools will still apply workspace brand memory when you call `directImageGen`).
  - `product_summary`: 3–5 sentences explaining what the product is, who it’s for, key benefits.
  - `campaign_context`: short text combining objective, funnel stage, important constraints from the brief.
  - `channels`: list of channel identifiers (e.g. `["instagram_feed", "website_hero", "pdp"]`).
- Call `select_storytelling_techniques` with these.
- The tool returns up to 4 techniques with `{ id, name, category, why_selected, visual_signature, prompt_modifier }`. The **prompt_modifier** and **visual_signature** are the **full text** from the creative-direction reference — use them **verbatim** when assembling prompts for D5–D8.

If it returns fewer than 4 techniques or an empty list, you may still proceed by choosing 1–2 techniques and reusing them, but prefer 4 distinct ones when available.

### Step 5 — Define 8 creative directions (D1–D8)

Create **8 direction specs**:

**D1–D4 — Default compositional directions (no storytelling technique module):**
- Use your internal understanding (you are trained with templates similar to Hero / Lifestyle / Dynamic / Detail) to ensure diversity in:
  - Camera (hero straight-on, lifestyle 3/4, dynamic low angle, macro/detail).
  - Composition (centered, rule of thirds, diagonal, close crop).
  - Lighting and color (studio brand-primary, warm lifestyle, bold dynamic, muted/detail).
- Think of them as:
  - D1: Hero product shot (clear, authoritative, product-forward).
  - D2: Lifestyle / environmental (product in real context, possibly with model).
  - D3: Dynamic / action (energy, scroll-stopping).
  - D4: Detail / texture (macro craft and material quality).

**D5–D8 — Storytelling-driven directions:**
- For each of the 4 techniques returned by `select_storytelling_techniques`, create one direction:
  - Name it clearly (e.g. “T03 — Quiet Luxury Hero”, “T05 — In-Motion Reveal”).
  - Incorporate the `prompt_modifier` and visual signature into the direction spec.

For each of the 8 directions (D1–D8), write a short **direction card**:
- Name.
- 3–6 bullet points covering: subject focus, camera, composition, lighting, color, atmosphere, and for D5–D8 the storytelling angle.

Stream these 8 direction cards to the user in a concise list. Do not wait for their response before moving to prompt assembly.

### Step 6 — Assemble 8 prompts (no extra tools)

For each direction, assemble **one final prompt string** using this order (adapted from PROMPT_ARCHITECT):

`[STYLE] + [SUBJECT] + [CAMERA] + [COMPOSITION] + [LIGHTING] + [COLOR] + [ATMOSPHERE] + [STORYTELLING] + [BRAND] + [CHANNEL]`

Guidelines:
- **STYLE/SUBJECT/CAMERA/COMPOSITION/LIGHTING/COLOR/ATMOSPHERE**: describe concrete, physical visual details (camera angle, lens feel, background, light quality, palette, mood).
- **STORYTELLING (D5–D8 only)**: inject the **full** `prompt_modifier` from the selected technique (the tool returns the exact text from the reference — use it verbatim). For D1–D4, you may omit this module.
- **BRAND**: include brand colors and tone from the brief/conversation in natural language (e.g. “brand visual identity with deep cobalt blue (#123456) as the hero accent…”). `directImageGen` still merges saved workspace memory into execution. Do **not** ask to generate a logo; just describe colors and mood.
- **CHANNEL**: mention key format constraints (e.g. “optimized for Instagram feed 4:5 portrait, thumb-stopping at small size”, or “optimized for e-commerce PDP 1:1 with pure white background”).

Hard rules:
- Keep each prompt under **200 words**.
- Do **not** ask the model to render any text, headlines, or logos.
- Be concrete and visual, not abstract (“soft golden-hour window light on the product” instead of “nice lighting”).

Also compose a **simple negative prompt** you can reuse, excluding:
- Deformed/distorted anatomy, extra limbs/fingers.
- Watermarks, text, logos, frames, borders.
- For product shots: cartoon/anime/illustration/3D if not desired.

You do **not** need a tool for prompt assembly; write the prompts directly.

### Step 7 — Generate one preview image per direction

For each of the 8 directions:
- Call the **`generateSingleImage`** tool with:
  - `prompt`: the assembled prompt string for that direction.
  - `aspect_ratio`: choose based on the primary channel (e.g. Instagram feed → 4:5 or 1:1; PDP → 1:1; hero → 16:9).
  - `asset_urls`: include product images if available and relevant.

This will produce **8 preview images**, one per direction. The UI will show them as they stream in.

After the 8 images appear, send a short message like:
> “Here are 8 creative directions with one preview each. Which direction(s) do you like the most (e.g. 2 and 5)?”

Then **wait** for the user’s selection.

### Step 8 — Generate more variations for selected directions

When the user specifies which directions they like (e.g. “2 and 5”):
- Map each selected number back to its direction prompt.
- For each selected direction:
  - If they want **multiple variations** (e.g. “give me 3 more like 2”):
    - Call `directImageGen` with:
      - `user_prompt`: the assembled prompt for that direction.
      - `num_variations`: default 3 (or the number they asked for, capped reasonably).
      - `asset_urls` / `reference_images`: as appropriate.
  - If they only want **one more**:
    - You can call `generateSingleImage` again with the same prompt.

Do **not** introduce any new model routing or SOTA stages. Always use the same underlying image generation model (the one behind `directImageGen` and `generateSingleImage`).

Conclude with a short summary of what you generated and next steps (e.g. which directions are strongest for their objective).

