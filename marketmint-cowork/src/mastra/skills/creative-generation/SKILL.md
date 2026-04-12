---
name: creative-generation
description: 'Use for any image generation that does not match garment-in-lifestyle, garment-in-studio, non-garment-in-lifestyle, or non-garment-in-studio. Includes: animals (horse, dog, etc.), "lifestyle images of X" when X is not a product, marketing/creative images for products when no specific workflow fits, and generic "generate images of X". Do not use for image editing.'
---

# Creative Generation — Guidelines

This skill covers image generation requests that do not map to garment/non-garment lifestyle or studio spaces (e.g. marketing images, creative images, social ads, animals, generic "generate images of X").

Example requests:
- "Generate images of a horse"
- "Generate marketing images for this water bottle"
- "Generate social static ads for this shoe"

---
## Required tool

You must use the **directImageGen** tool to generate the final images. Use only this tool for image generation; do not use any other tool for the actual generation step.

---
## directImageGen parameters

- **user_prompt**: Pass the user's request as-is. If they specified style/theme or number of images, incorporate that into the prompt or parameters; otherwise pass their request verbatim.
- **asset_urls**: Primary assets (main subjects): product images, garment images, objects the user wants in the image. Extract from asset catalog when the user attached or referred to assets.
- **reference_images**: Images used for style, mood, composition, or aesthetic inspiration (e.g. "generate in this style", "use this as reference"). Not main subjects.
- **num_variations**: Number of images to generate **in this tool call** (not “total for the whole plan” unless there is only one call).  
  - If the user **specified** how many images they want: use that exact number for num_variations **on a single call**. If you split the work into multiple batches (task_group_id / batch_index / total_batches), set num_variations to **this batch’s share** only (e.g. 6 images in 3 batches → **2 per batch**). Using 1 per batch when each batch should produce two images will underbill credits vs images produced.
  - If the user **did not specify**: use **num_variations = 3** (generates 3 total images). Do not ask how many images they want.  
  - **Never pass num_variations = 0** unless the user explicitly asked for a single image.
- **acknowledgement**: Optional short message before generation.
- **should_use_brand_memory**: Set to True if the user asked to use brand memory or if BRAND MEMORY SELECTED STATUS indicates they want it. If the user explicitly asked for brand memory despite the toggle, prefer the user and set True.

Do not ask clarification questions about number of variations or style/theme preferences. If the user already mentioned them, use those; otherwise use the defaults above and pass their request as-is to directImageGen.

---
## Reference-image requests: product-swap vs inspiration

When the user has a **primary image** (their product) and a **reference image or images** and asks to generate images "similar to" or "like" the reference, decide intent from their wording and set **user_prompt** accordingly:

- **Product-swap (reference-as-scene)** — User wants the **same** scene/composition/pose/setting as the reference but with **their** product (e.g. "like this but for my ring", "same as this but with my product", "create image like this but for my input jewellery").
  - Put the user's product in **asset_urls**, the reference in **reference_images**.
  - Set **user_prompt** to explicitly state that the reference defines the exact composition, pose, setting, and lighting and that only the product/subject should be the one from the provided asset. Example: *"Generate an image with the exact same composition, pose, setting, and lighting as the reference image. Only replace the product/jewellery visible in the reference with the provided product."*

- **Inspiration / moodboard (reference-as-inspiration)** — User wants style/mood inspiration but not a literal copy (e.g. "take inspiration from these", "similar to this moodboard", "in the style of these images").
  - Put the user's product in **asset_urls**, the reference(s) in **reference_images**.
  - Set **user_prompt** to state that the reference(s) are for **style/mood inspiration only**, the main subject must be the provided product, and the setting/composition **can be reimagined**. Example: *"Use the reference image(s) for style, mood, and aesthetic inspiration only. Keep the provided product as the main subject. The setting and composition can be reimagined to match the mood of the references."*

---
## Assets

- **Primary Assets (`asset_urls`)**: Main subjects (product, garment, object to generate images of).
- **Reference Images (`reference_images`)**: Style, mood, composition, or aesthetic reference only.
- If the user attached assets in the current message (see asset catalog), put them in `asset_urls` or `reference_images` as appropriate.
- If the user referred to outputs from a previous tool run, include those URLs in `asset_urls` (or `reference_images` if they said style reference) from the asset catalog.
- If the user wants assets from a URL or search, use `extractImagesFromUrl` or `searchImages` first, show results, get approval, then pass approved URLs to directImageGen. If they have no assets and the request needs them, ask them to upload or provide a URL/search.

---
## Behavioral guidelines

- Use only **directImageGen** for the final image generation step.
- Do not ask "how many images" or "what style/theme" unless the user's request is ambiguous in a way that affects assets (e.g. which images to use). For creative/marketing generation, default to num_variations = 3 and the user's prompt as-is.
- If the user asked to use brand memory or the frontend indicates brand memory is selected, set `should_use_brand_memory` to True.
