# Grok Imagine — Video Generation Guide

## How to Generate a Video

You have three paths to generate a video:

### Text-to-Video
Type a description and generate a video clip directly, without starting from an image. Write like you are describing the scene to a friend: what is happening, what it looks like, how the camera moves. This path works best when you have a clear scene in mind and want to skip the image step entirely.

### Image-to-Video
Start from any image and animate it into a short clip with synced audio. The image can be one you generated in Imagine, or one you upload from your camera roll or desktop.

This is where most creators spend their time. Because you already know what the base image looks like, the video output is more predictable. You control the starting frame, then use your prompt to describe what should move and how.

Some examples to try:
- **Camera movement:** "Camera pans to the right and slowly zooms in, keeping subject centered."
- **Open ended:** "Subtle organic scene movement."

> **Pro tip:** Generate an image first using a detailed prompt. Review it. If the composition, lighting, and subject look right, tap the video icon to animate it. Keep your video prompt short since Grok already has the image as context. Focus on describing the motion, camera movement, and mood.
>
> **Example:**
> - *Image prompt:* "Two otters in aquamarine water, viewed from above with a vintage film aesthetic."
> - *Video prompt:* "Calm organic movement, subject is still and pulls out slowly. Otters slightly drifting, mostly calm."

### Reference-to-Video
Upload up to 7 reference images and use them as the visual foundation or style reference for a video. Grok blends your reference with your text prompt, so you get output that matches a specific look or feel without starting from scratch. This is useful when you want your video to match an existing brand style, color palette, or visual tone.

---

## Choosing Your Settings

Before you generate, pick your settings:

- **Aspect ratio** — Grok Imagine supports five aspect ratios: 16:9, 9:16, 3:2, 2:3, and 1:1. Choose based on where you plan to post.
- **Duration** — Select how long you want your clip to be.
- **Quality** — Choose your preferred output quality. Grok supports videos in 480p or 720p.

Hit **Generate** and your clip will be ready in seconds. From there you can download it, save it to your library, or upload it directly to X.

---

## Extending Your Videos

A single generation gives you a short clip. Grok Imagine's **Extend Video** feature lets you go further.

Select any frame of a generated clip and use it as the starting point for an extension. The model carries forward the motion, character positioning, lighting, and audio from that frame. Each extension adds additional seconds, and you can keep chaining them together.

The system preserves visual continuity across extensions, so the final result feels like one continuous take rather than separate clips stitched together. This is what makes it possible to build product demos, short narratives, explainer sequences, and multi-beat content that goes well beyond what a single generation can produce.

> **Tip for extending:** Write a continuation prompt that describes what happens next in the scene, not a full re-description of the whole thing. The model already knows what the scene looks like. Just tell it where to go from here.
>
> - **Too much:** "A woman in a red dress sitting at a rain-streaked cafe window at night with neon reflections, she stands up and walks toward the door"
> - **Better:** "She stands up slowly, grabs her coat, and walks toward the door. The camera follows."

---

## Writing Prompts That Produce Great Videos

The quality of your output starts with the prompt. Specific ones give Grok clear anchors to work from, but avoid getting too prescriptive to allow for some creative freedom.

**A reliable prompt structure:**

```
Subject + style/mood + lighting + camera angle + finishing details
```

**In practice:**
- **Vague:** "a city at night"
- **Specific:** "futuristic Tokyo street at 2am, rain-slicked asphalt, neon reflections, low-angle wide shot, cinematic fog, Blade Runner mood"

The second prompt tells Grok exactly what to aim for: location, time, lighting, camera position, and tonal reference. Each detail eliminates ambiguity and gives the model something concrete to execute on.

### Let Grok Write Your Prompts

If you are not sure how to structure a detailed prompt, you can ask Grok to do it for you. Open a regular Grok chat, describe what you are going for in plain language, and ask it to generate an Imagine prompt. Then copy that prompt into the Imagine interface.

This is especially useful when you have a clear idea in your head but are not sure which details will translate best into a generation prompt.

> **Pro tip:** Use Grok Projects for recurring creation of storyboards based on your ideas. Grok will give you all the prompts you need based on your input and previous instructions for storyboard development. Grok Projects let you set custom instructions and upload files to a dedicated workspace — every conversation inside a Project carries that context forward, so you never have to re-explain the context of what you're trying to achieve.

---

## Tips for Better Video Results

- **Keep compositions focused.** A clear subject against a defined background consistently beats a busy, crowded scene. When in doubt, simplify. *(Example: "a single vendor arranging flowers at a market stall, soft morning light, blurred background")*
- **Go wider for people in video.** Wider shots and slower movements produce the cleanest results when there are people in the frame. Pull the camera back and let the motion breathe. *(Example: "a woman walking through a sunlit courtyard, mid-shot from the waist up, slow steady tracking, gentle breeze")*
- **Reference moods, not just adjectives.** "Blade Runner mood" or "Studio Ghibli feel" gives Grok a rich visual library to draw from. Single adjectives like "dark" or "soft" are too open-ended to steer the output on their own.
- **Name your lighting.** "Golden hour backlight," "overcast diffused light," and "hard rim light from the left" produce completely different videos. Lighting is a high-leverage detail you can specify.
- **Name your camera movement.** "Slow dolly in," "pan right," "static wide" translate directly into how Grok animates the scene. If you do not specify camera movement, you are leaving one of the most important creative decisions up to chance.
- **Keep image-to-video prompts short.** When you are animating an existing image, Grok already has the visual context. Your text prompt just needs to describe what should move and how. Do not re-describe the entire scene.
- **Run the same prompt more than once.** Grok produces different results each time, even from the same prompt and image. If the first generation does not land, try it again before rewriting anything. This is especially true for image-to-video, where small differences in how the model interprets motion can make a big difference in the final clip.
- **Save prompts that worked.** Outputs vary between runs, even with the same prompt. When something lands, keep the exact prompt so you can build on it.
- **Use featured templates.** Grok Imagine has a library of featured templates you can browse at the top of the Imagine tab — rotating pre-built styles like Funky Dance, Chibi, 3D Animation, Comic Book, 80s Anime, and more. This is a fast way to create stylized content and explore what Imagine can do if you are just getting started.

---

## Prompts Worth Trying

**World building (text-to-video):**
> "aerial drone slowly descending over an ancient stone temple reclaimed by jungle, golden hour shafts of light cutting through the canopy, muted greens and amber, birds scattering from the treetops, epic scale, ambient jungle sounds"

**Action sequence (text-to-video):**
> "a surfer dropping into a massive wave at golden hour, low-angle tracking shot following the board, water spray catching the light, cinematic slow motion, ocean roar and muffled underwater sounds"

**Product shot (image-to-video):**
> Generate or upload an image of a physical product. Then animate with: "camera doing a slow 360 orbit, sharp shadow rotating with the light, subtle ambient tone"

**Portrait (image-to-video):**
> Generate or upload a close-up portrait of a person. Then animate with: "wind gently moving their hair, camera slowly pulling back, ambient city sounds, soft film grain"

**Mood piece (image-to-video):**
> Generate or upload an image of someone sitting alone in a cafe window. Then animate with: "barely-there movement, steam rising from the coffee cup, rain streaking down the window, lo-fi ambient soundtrack"

---

## Where Imagine Fits in a Creator's Workflow

- **Reactive content** — Something is trending and you need a visual now. Grok gets you from idea to a shareable clip in under a minute, fast enough to post while the moment is still relevant.
- **Explainer clips** — A 10-second animated sequence can communicate something a static image or a paragraph of text cannot. Useful for breaking down concepts, showing processes, or adding motion to a point you are making in a thread.
- **Product content** — Use image-to-video to turn product photos into polished motion content. Extend Video lets you build longer walkthroughs that show multiple angles or features.
- **Creative exploration** — Generate a batch of visual directions quickly. Use video as a way to test whether an idea has energy before committing to a full production.
- **Multi-beat storytelling** — Storyboard your concept in Grok chat, generate each shot in Imagine, then chain them together with Extend Video or combine them in your editor. This is how you go from a single clip to a complete visual narrative.

---

## Organizing Your Work with Tags

As you generate more content, your library fills up fast. Grok Imagine has a tagging feature that lets you keep everything sorted.

To create a tag: go to the **Saved** tab inside Imagine, click the **New tag** button, and name it. Then hover over any saved image or video, tap the tag icon, and select the tag you want to apply. You can filter your library by tag at the top of the Saved screen.

This is especially useful if you are running multiple projects at once. Create a tag for each campaign, content series, or client so you can find what you need without scrolling through everything. For example, you might have tags for "product launch," "memes," and "tutorial series" all running at the same time.
