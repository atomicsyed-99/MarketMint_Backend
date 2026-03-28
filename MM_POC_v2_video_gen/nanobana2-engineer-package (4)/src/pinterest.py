"""
Pinterest style reference scraper.

Uses pinterest-dl's unofficial API backend (no browser required) to fetch
images in memory and return them as PIL Images ready to pass as style
references to NanoBanana2.
"""

import io
import random
import urllib.request
from typing import List, Tuple

from PIL import Image as PILImage

_FETCH_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}


def scrape_style_images(query: str, count: int = 1) -> List[Tuple[PILImage.Image, str]]:
    """Search Pinterest for `query` and return up to `count` (image, url) pairs.

    Uses the pinterest-dl unofficial API backend — no browser startup required.
    Images are fetched into memory; nothing is written to disk.
    Failed fetches are silently skipped; you may receive fewer than `count`
    results if Pinterest returns unreachable URLs.

    Args:
        query: Search term (e.g. "editorial fashion urban street").
        count: Maximum number of images to return. Defaults to 1.

    Returns:
        List of (PIL.Image, url) tuples. Empty list if search fails entirely.
    """
    try:
        from pinterest_dl import PinterestDL
    except ImportError:
        raise ImportError("pinterest-dl is required: pip install pinterest-dl")

    try:
        scraper = PinterestDL.with_api(timeout=10)
        # Fetch top 20 results and select from those — balances quality/variety with speed
        pins = scraper.search(query, num=20, min_resolution=(600, 600))
    except Exception as e:
        raise RuntimeError(f"Pinterest search failed: {e}") from e

    random.shuffle(pins)

    results: List[Tuple[PILImage.Image, str]] = []
    for pin in pins:
        if len(results) >= count:
            break
        if not pin.src:
            continue
        try:
            req = urllib.request.Request(pin.src, headers=_FETCH_HEADERS)
            with urllib.request.urlopen(req, timeout=8) as resp:
                img = PILImage.open(io.BytesIO(resp.read())).convert("RGB")
            results.append((img, pin.src))
        except Exception:
            continue

    return results
