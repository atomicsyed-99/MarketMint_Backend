import os
import sys
from dotenv import load_dotenv

load_dotenv()

from PIL import Image as PILImage
from src.pipeline import PromptCompiler
from src.llm_router import LLMRouter


def main():
    print("=== NanoBanana 2 Image Generator ===\n")

    query = input("Query: ").strip()
    if not query:
        print("No query provided. Exiting.")
        sys.exit(1)

    uploaded_images = []
    print("Image paths (press Enter with no input when done):")
    while True:
        path = input("  Image path: ").strip()
        if not path:
            break
        try:
            uploaded_images.append(PILImage.open(path).convert("RGB"))
            print(f"  Loaded: {path}")
        except Exception as e:
            print(f"  Warning: could not load {path}: {e}")

    output_path = input("Output path [output.png]: ").strip() or "output.png"

    compiler = PromptCompiler(LLMRouter())

    print("\n--- Stage 1+2: classify + build prompt ---")
    prompt, context = compiler.build_nanobanana_prompt(query, uploaded_images=uploaded_images)
    print(f"Prompt:\n  {prompt}")
    print(f"Subject images:    {len(context['subject_images'])}")
    print(f"Style images:      {len(context['style_images'])}")
    print(f"Character image:   {context['user_character_image'] is not None}")
    print(f"Scene image:       {context['user_scene_image'] is not None}")
    print(f"Ad copy:           {context['enhancement'].get('ad_copy') or '(none)'}")

    go = input("\nProceed to image generation? [Y/n]: ").strip().lower()
    if go == "n":
        print("Stopped after prompt build.")
        sys.exit(0)

    print("\n--- Stage 3: generating image ---")
    result = compiler.generate(
        user_query=query,
        uploaded_images=uploaded_images,
        output_path=output_path,
    )

    print(f"\nStatus:       {result['status']}")
    print(f"Output:       {result.get('image_path') or result.get('image_url')}")
    print(f"Time:         {result.get('generation_time_ms')}ms")
    if result.get("pinterest_url"):
        print(f"Pinterest ref: {result['pinterest_url']}")
    print(f"\nPrompt used:\n  {result['prompt_used']}")


if __name__ == "__main__":
    main()
