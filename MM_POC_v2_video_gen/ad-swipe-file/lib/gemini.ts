import sharp from 'sharp';
import fs from 'fs/promises';
import type { AiAnalysis } from '@/types';

const API_KEY = () => process.env.GEMINI_API_KEY!;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

async function prepareImageBase64(filePath: string): Promise<{ base64: string; mimeType: string }> {
  const buffer = await fs.readFile(filePath);
  const resized = await sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

export async function analyzeAd(filePath: string): Promise<AiAnalysis> {
  const { base64, mimeType } = await prepareImageBase64(filePath);

  const response = await fetch(
    `${BASE_URL}/models/gemini-2.5-flash:generateContent?key=${API_KEY()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: { mime_type: mimeType, data: base64 },
              },
              {
                text: `Analyze this ad creative in detail. Return a JSON object with these exact fields:
{
  "layout": "detailed description of the ad layout — composition, visual hierarchy, positioning of elements, border/frame treatment, text placement, and overall structure",
  "imagery": "detailed description of what is visually depicted — people (appearance, pose, action, expression), objects, products, colors, background, setting, lighting, style",
  "headline": "the main headline or tagline text visible in the ad, verbatim. Empty string if none",
  "offer": "what product, service, or value proposition is being promoted and how",
  "hook": "description of the visual/text hook used to grab attention",
  "structure": "layout and composition description",
  "target_audience": "inferred target demographic",
  "cta_description": "call-to-action analysis",
  "emotional_appeal": "emotional triggers used",
  "platform_fit": "which platforms this would work best on",
  "summary": "2-3 sentence overall analysis",
  "visual_description": "a literal, objective description of everything visible in the image — people (gender, ethnicity, pose, clothing, action such as sitting/standing/walking), objects, products, text, background, setting, colors. Focus on what a person would see, not marketing interpretation",
  "search_tags": "comma-separated list of 10-20 descriptive tags covering: visual content (e.g. woman sitting, chair, outdoor), style (e.g. minimalist, colorful), product category, brand, mood, colors, and any other searchable attributes",
  "suggested_brand": "brand name if visible, otherwise empty string",
  "suggested_platform": "one of: meta, tiktok, youtube, google, snapchat, other",
  "suggested_format": "one of: static, carousel, video, story, reel, ugc, other",
  "suggested_hook_angle": "one of: problem_solution, testimonial, before_after, curiosity, urgency, social_proof, polished_brand, other",
  "suggested_cta": "one of: shop_now, learn_more, sign_up, download, book_now, get_offer, other"
}`,
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini analysis failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No analysis returned from Gemini');

  return JSON.parse(text) as AiAnalysis;
}

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch(
    `${BASE_URL}/models/gemini-embedding-2-preview:embedContent?key=${API_KEY()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Text embedding failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

export async function embedImage(filePath: string): Promise<number[]> {
  const { base64, mimeType } = await prepareImageBase64(filePath);

  const response = await fetch(
    `${BASE_URL}/models/gemini-embedding-2-preview:embedContent?key=${API_KEY()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          parts: [{ inline_data: { mime_type: mimeType, data: base64 } }],
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Image embedding failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}
