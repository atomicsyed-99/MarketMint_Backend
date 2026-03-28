# NanoBanana 2 — Image Generation Pipeline Spec

## What This Is

A three-stage pipeline that takes a user query + optional uploaded images and produces a generated image via Google Gemini's multimodal image generation model (`gemini-3.1-flash-image-preview`, internally called NanoBanana 2).

The pipeline's job is to:
1. Classify uploaded images by role (subject, style reference, character, scene)
2. Optionally select brand memory assets (characters, scenes, poses) that fit the request
3. Assemble a short, natural-language prompt
4. Send everything to the image generator

---

## Tool Interface

```python
def generate_image(
    query: str,
    uploaded_images: list[PIL.Image] = [],
    brand_memory: dict = None,
    use_brand_memory: bool = True,
) -> dict:
    """
    Args:
        query:            The user's natural-language request.
                          Can be vague — e.g. "give me an ad for this".
        uploaded_images:  Zero or more PIL images. Roles are auto-classified.
                          Common pattern: [product_shot_1, product_shot_2, style_ref].
                          There will ALWAYS be at least one product/subject image if
                          a style reference is also uploaded.
        brand_memory:     Parsed JSON brand memory object. See Brand Memory section.
        use_brand_memory: If False, all brand memory assets and reference pool
                          selection are skipped. Pinterest fallback becomes active.

    Returns:
        {
            "status":        "success" | "failed: <reason>",
            "image_path":    str,
            "prompt_used":   str,
            "pinterest_url": str   # empty string if Pinterest was not used
        }
    """
```

---

## Pipeline Stages

### Stage 1 — Enhancement & Classification

One LLM call (Gemini Flash) that does three things simultaneously:

**A. Image Classification**

Each uploaded image is classified into one of four roles by visually inspecting the image content. The user's query provides context but role assignment is primarily visual:

| Role | What it is | How it's used |
|---|---|---|
| `subject` | A product or object to feature | Sent to generator as the thing to photograph |
| `style_reference` | Mood, aesthetic, or composition reference | Sent to generator as visual style guidance |
| `character` | A specific person to use as the model | Sent as a directive character reference |
| `scene` | A background or environment | Sent as the background/setting |

**Classification rules:**
- Classify by visual content, not by query language — queries are typically vague ("give me an ad for this")
- Multiple images of the same product from different angles → all classified as `subject`
- Only classify as `style_reference` if the image is clearly different subject matter used for aesthetic inspiration, not as a product to feature
- If LLM returns no classifications at all → default all uploaded images to `subject`

**B. Brand Reference Selection** (only when `use_brand_memory=True`)

The LLM is shown an indexed list of brand memory assets (characters, scenes, poses) and selects 0–2 indices that best fit the user's request. Selection is based on the asset descriptions in the brand memory, not by fetching images.

**C. Ad Copy Extraction**

Only populated when the user explicitly asks for text in the image (e.g. "write BLOOM as a headline"). The LLM extracts the user's exact words — no additions, no font names, no placement instructions. Empty otherwise.

---

### Stage 2 — Prompt Assembly

Constructs a short, natural-language prompt using the NanoBanana 2 prompting technique:

```
[user query]. [relationship clauses for each attached image]

Text to render:       ← only if ad copy non-empty
{ad copy}
```

**Relationship clause order:**
1. Logo: "Include the brand logo from the attached logo image."
2. Scene: "Use the attached scene image for the background."
3. Character: "Use the person from the attached character reference as the model."
4. Subject: "Use the attached product image as the subject."
5. Style: "Match the visual style of the attached style reference image."

Only clauses for images that are actually being sent are included.

**Character clause fires when:**
- The user uploaded an image classified as `character`, OR
- The brand memory reference selection (Stage 1B) included a character asset

Both cases produce the same directive prompt clause and the same directive image label. Brand memory characters are not passive.

**Ad copy gate:** Ad copy is only included in the prompt if the user's query contains an explicit text request keyword: `write`, `text`, `headline`, `tagline`, `cta`, `label`, `say`, `caption`, `add text`, `display`, `copy`.

---

### Stage 3 — Image Generation

The generator call (NanoBanana 2) receives:
- The assembled prompt (text)
- All reference images as multimodal parts, in this order:

```
1. Logo image              (only if ad workflow AND user explicitly requested text)
2. Brand reference images  (brand site screenshots, same gate as logo, only if no character)
3. Scene image             (user upload OR brand memory scene, user takes priority)
4. User character image    (label: "use this specific person as the model")
5. Brand character image   (label: "use this person as the model")
6. Pose image              (brand memory pose reference)
7. Subject images          (all user-uploaded product images)
8. Style images            (user-uploaded style ref + Pinterest image if fetched)
9. Prompt text
```

Each image group is preceded by a short natural-language label that tells the model how to interpret it.

**Optional foundation skill fragments** (only when `use_foundation_skills=True`):

Two fragments are appended after the prompt when enabled:

| Skill | When active | What it adds |
|---|---|---|
| `product_fidelity` | Always | Instructs model not to redesign the product — "optical digital twin" constraint |
| `photorealism` | Always | Commercial finish guidance — "no over-smoothing, fake glow, or HDR halos" |
| `ad_iconic` | Ad workflow queries | "Generate bold, visually arresting product advertisements where the product commands full attention." |
| `typography` | Ad workflow AND user requested text | Large-format text hierarchy and readability rules |

Skills intentionally excluded: `commercial_finish` (too generic), `negative_prompts` (Gemini has no native negative prompt parameter — SD-era concept), all other skill files (only used on-demand via the skills override panel).

---

## Brand Memory

A JSON object with the following structure (only the fields the pipeline uses):

```json
{
  "name": "Brand Name",
  "logos": [{ "url": "https://...", "width": 200, "height": 200 }],
  "fonts": [{ "family": "Playfair Display" }, { "family": "Inter" }],
  "characters": [{
    "url": "https://...",
    "metadata": {
      "name": "Sarah",
      "enriched_data": { "description": "Young woman, 20s, minimal aesthetic..." }
    }
  }],
  "scenes": [{
    "url": "https://...",
    "metadata": {
      "title": "Urban Rooftop",
      "enriched_data": { "description": "Rooftop terrace, golden hour, city skyline..." }
    }
  }],
  "poses": [{
    "url": "https://...",
    "metadata": {
      "enriched_data": { "description": "Standing, arms relaxed, three-quarter angle..." }
    }
  }],
  "site_images": ["https://cdn.brand.com/hero1.jpg", "https://cdn.brand.com/hero2.jpg"]
}
```

**Priority rules:**
- Brand memory character is skipped if the user uploaded a character image
- Brand memory scene is skipped if the user uploaded a scene image
- Brand memory character, when selected, produces the same directive prompt clause and image label as a user-uploaded character — it is not passive
- Brand fonts apply only when the user explicitly requests text in the image
- Logo and site screenshots are only included when the query is BOTH an ad workflow keyword AND the user explicitly requests text. "Give me an ad for this" alone does not trigger logo/branding — the user must ask for text.

---

## Pinterest Fallback

When `use_brand_memory=False` and no scene image exists, the pipeline searches Pinterest for a style reference using the user's raw query (not LLM-derived keywords).

**Fires when ALL of the following are true:**
- `use_brand_memory` is `False`
- No scene image (user uploaded or brand memory)
- Query does not contain editing keywords: `swap`, `retouch`, `skin enhancement`, `background replacement`, `remove background`, `replace background`

**When Pinterest returns an image:**
- Image is appended to `style_images`
- Prompt gets an extra clause: "Match the visual style of the attached style reference image."

**Constraints:**
- Hard 12-second wall-clock cap — if Pinterest doesn't respond in time, it is silently skipped
- Only 1 image is selected, chosen randomly from the top 20 results
- Minimum resolution: 600×600

---

## Key Design Constraints

1. **Vanilla prompts only.** The user's query is sent as-is. No rewriting, no enrichment, no paraphrasing.

2. **No text by default.** Ad copy, typography skill, logo, and site screenshots are never triggered unless the user explicitly asks for text. The presence of an ad-type workflow keyword alone does not trigger any text-related asset.

3. **Brand memory wins over Pinterest.** If brand memory is active, Pinterest is completely skipped.

4. **User uploads win over brand memory.** If the user uploads a character or scene image, the brand memory version for that role is not used.

5. **Classification is visual.** Image roles are determined by what the image looks like, not by what the user says. The query is context, not the source of truth.

6. **Multiple product shots are all subjects.** When a user uploads several angles of the same product, every one of them is a `subject`. The generator uses all of them for higher product fidelity.

7. **Style reference always comes with a subject.** Users never upload a style reference without also uploading at least one product/subject image.

8. **Foundation skills are additive constraints, not enrichment.** They constrain model behaviour (product fidelity, photorealism) or give composition direction (ad_iconic). They do not add creative content or rewrite the user's query.
