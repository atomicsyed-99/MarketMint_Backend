import time
import os
import io
import base64
from typing import Dict, Any, List, Optional
from PIL import Image as PILImage
from src.llm_router import _pil_to_part

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None


class NanoBananaGenerator:
    def __init__(self):
        self.api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get(
            "GOOGLE_API_KEY"
        )
        if genai and self.api_key:
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None
            print(
                "Warning: Google GenAI client not initialized. Ensure 'google-genai' and 'pillow' are installed and GEMINI_API_KEY or GOOGLE_API_KEY is set. Using fallback stubs."
            )

    def generate_image(
        self,
        final_prompt: str,
        subject_images: Optional[List[PILImage.Image]] = None,
        style_images: Optional[List[PILImage.Image]] = None,
        user_character_image: Optional[PILImage.Image] = None,
        scene_image: Optional[PILImage.Image] = None,
        seed: int = 42,
        output_path: str = "output_image.png",
        aspect_ratio: Optional[str] = None,
    ) -> Dict[str, Any]:
        if subject_images is None:
            subject_images = []
        if style_images is None:
            style_images = []

        if not self.client:
            print(f"\n[NanoBanana 2 Fallback] Connecting to mock endpoint...")
            time.sleep(1)
            return {
                "status": "success (mock)",
                "image_url": "mock_output.png",
                "generation_time_ms": 1000,
                "seed": seed,
                "prompt_used": final_prompt,
            }

        print(f"\n[NanoBanana 2] Generating image with Google GenAI...")
        start_time = time.time()

        try:
            # Build multimodal contents: scene → character → subjects → styles → prompt
            has_any_image = (
                scene_image is not None
                or user_character_image is not None
                or len(subject_images) > 0
                or len(style_images) > 0
            )
            if has_any_image:
                contents = []
                if scene_image:
                    contents.append(
                        types.Part.from_text(
                            text="Attached scene image — keep the background structure readable and in focus; do not reproduce any text visible in this image:"
                        )
                    )
                    contents.append(_pil_to_part(scene_image))
                if user_character_image:
                    contents.append(
                        types.Part.from_text(
                            text="Attached character/model reference — this is the EXACT person who must appear in the image. "
                            "Match their face precisely: same facial bone structure, same skin tone, same nose shape, "
                            "same eye shape, same jawline, same lips, same hair color and texture. "
                            "If the reference shows piercings (nose ring, earrings), include them. "
                            "Do NOT generate a different person. The face in the output must be recognizably "
                            "the same individual as in this reference photo. "
                            "If a text description of the subject conflicts with this photo, follow the PHOTO:"
                        )
                    )
                    contents.append(_pil_to_part(user_character_image))
                if subject_images:
                    contents.append(
                        types.Part.from_text(
                            text="Attached product image — treat this as the AUTHORITATIVE asset reference. "
                            "Reproduce the product EXACTLY as shown: same shape, proportions, color, materials, "
                            "trim, pattern placement, embroidery designs, and branding. "
                            "CRITICAL: Do NOT simplify, remove, or alter any embroidery, prints, or decorative elements. "
                            "If the reference shows embroidery or patterns on specific areas (neckline, hem, cuffs, borders), "
                            "those same patterns must appear in the same locations with the same density and detail. "
                            "Do not shift embroidery, motifs, or design elements to different positions on the garment. "
                            "If a text description of the product conflicts with this photo, follow the PHOTO. "
                            "IMPORTANT: completely IGNORE the background/environment in this reference image. "
                            "The background here (store, studio, plain backdrop, etc.) is NOT part of the product — "
                            "use ONLY the scene description in the prompt to determine the setting and background. "
                            "Ignore any text or overlays on it:"
                        )
                    )
                    for img in subject_images:
                        contents.append(_pil_to_part(img))
                if style_images:
                    contents.append(
                        types.Part.from_text(
                            text="Attached style reference image — match ONLY the color palette, lighting mood, and visual tone. "
                            "Do NOT copy the composition, pose, camera angle, framing, or scene layout from this reference. "
                            "Do NOT let the style reference modify the attached asset design or details. "
                            "Generate a completely new composition as described in the prompt. Do not reproduce any text visible in this image:"
                        )
                    )
                    for img in style_images:
                        contents.append(_pil_to_part(img))
                contents.append(
                    types.Part.from_text(
                        text=final_prompt
                        + "\nBackground focus: use the setting described in the prompt above as the background; keep it visible and naturally in focus; avoid strong artificial background blur or shallow-depth portrait bokeh. Do NOT copy the background from any attached reference image."
                        + "\nAsset fidelity: if no person is present, reproduce the asset 1:1 from the reference image and keep the relative placement of neckline, hem, embroidery, motifs, seams, and labels unchanged."
                    )
                )
            else:
                contents = (
                    final_prompt
                    + "\nBackground focus: use the setting described in the prompt above as the background; keep it visible and naturally in focus; avoid strong artificial background blur or shallow-depth portrait bokeh. Do NOT copy the background from any attached reference image."
                    + "\nAsset fidelity: if no person is present, reproduce the asset 1:1 from the reference image and keep the relative placement of neckline, hem, embroidery, motifs, seams, and labels unchanged."
                )

            # Log the full prompt sent to Gemini into the keyframes directory
            try:
                output_dir = os.path.dirname(os.path.abspath(output_path))
                # If output is in scene_videos/, also log to keyframes/; otherwise log next to output
                keyframes_dir = output_dir
                parent = os.path.dirname(output_dir)
                kf_candidate = os.path.join(parent, "keyframes")
                if os.path.isdir(kf_candidate):
                    keyframes_dir = kf_candidate
                scene_base = os.path.splitext(os.path.basename(output_path))[0]
                log_path = os.path.join(keyframes_dir, f"{scene_base}_gemini_prompt.txt")
                os.makedirs(keyframes_dir, exist_ok=True)
                with open(log_path, "w") as f:
                    f.write("=== Gemini Image Generation — Full Input Prompt ===\n\n")
                    if isinstance(contents, list):
                        for i, part in enumerate(contents):
                            if hasattr(part, "text") and part.text:
                                f.write(f"--- Part {i} (text) ---\n{part.text}\n\n")
                            elif hasattr(part, "inline_data") and part.inline_data:
                                f.write(f"--- Part {i} (image: {part.inline_data.mime_type}) ---\n\n")
                    else:
                        f.write(str(contents))
                print(f"    Gemini prompt logged: {log_path}")
            except Exception as e:
                print(f"    Warning: Could not log Gemini prompt: {e}")

            gen_config = types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            )
            if aspect_ratio:
                gen_config.image_config = types.ImageConfig(aspect_ratio=aspect_ratio)

            result = self.client.models.generate_content(
                model="gemini-3.1-flash-image-preview",
                contents=contents,
                config=gen_config,
            )

            found_image = False
            for part in result.candidates[0].content.parts:
                if getattr(part, "thought", False):
                    continue
                if getattr(part, "inline_data", None):
                    os.makedirs(
                        os.path.dirname(os.path.abspath(output_path)), exist_ok=True
                    )
                    try:
                        if isinstance(part.inline_data.data, str):
                            img_data = base64.b64decode(part.inline_data.data)
                        else:
                            img_data = part.inline_data.data
                        image = PILImage.open(io.BytesIO(img_data))
                        image.save(output_path)
                        found_image = True
                        break
                    except Exception as e:
                        print(f"Error parsing image data: {e}")

            if not found_image:
                raise Exception("No image returned in response parts.")

            end_time = time.time()
            return {
                "status": "success",
                "image_path": output_path,
                "generation_time_ms": int((end_time - start_time) * 1000),
                "prompt_used": final_prompt,
            }
        except Exception as e:
            return {
                "status": f"failed: {str(e)}",
                "image_path": None,
                "generation_time_ms": 0,
                "prompt_used": final_prompt,
            }
