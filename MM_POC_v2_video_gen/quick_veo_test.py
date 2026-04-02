"""
One-shot Veo 3.1 Fast test — action/dialogue only, no person or background description.
The keyframe image carries all appearance/setting context.
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()
# Also load from the nanobana2 package .env where the API keys live
_pkg_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nanobana2-engineer-package (4)", ".env")
if os.path.exists(_pkg_env):
    load_dotenv(_pkg_env, override=False)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from veo_video_client import generate_video

KEYFRAME = "/home/jai/work/marketmint/V1/MM_BD/MarketMint_Backend/MM_POC_v2_video_gen/runs/run_055/keyframes/scene_01.png"
OUTPUT   = "/home/jai/work/marketmint/V1/MM_BD/MarketMint_Backend/MM_POC_v2_video_gen/runs/run_055/scene_videos/quick_test_scene_01.mp4"

# Stripped prompt: ONLY action + camera style + dialogue.
# No person description, no background description — the keyframe handles those.
PROMPT = (
    "She faces the camera with a warm, genuine smile. "
    "She brings her raised hand back down naturally to her side, "
    "maintains relaxed direct eye contact with the lens, and gives a small natural nod. "
    "Motion is subtle and realistic — the kind of movement a real person makes "
    "when greeting friends on a selfie video. "
    "UGC fashion testimonial style, hyperrealistic. "
    "Vertical smartphone video, locked-off tripod feel, eye-level framing. "
    "Full-body to medium-full composition, subject centered. "
    "Sharp focus on face and outfit. Natural available light. "
    'She speaks warmly and enthusiastically: "Hey guys, I just tried this Pongal kurti and I\'m obsessed."'
)

print("=" * 60)
print("  Quick Veo 3.1 Fast test")
print("=" * 60)
print(f"  Keyframe: {KEYFRAME}")
print(f"  Output:   {OUTPUT}")
print(f"  Prompt:\n{PROMPT}")
print("=" * 60)

result = generate_video(
    prompt=PROMPT,
    image_paths=[KEYFRAME],
    duration=6,
    aspect_ratio="9:16",
    resolution="720p",
    output_path=OUTPUT,
    fast=True,
)

if result.get("status") == "success":
    print(f"\n✓ Done: {result['video_path']} ({result['generation_time_ms']}ms)")
else:
    print(f"\n✗ Failed: {result.get('error')}")
