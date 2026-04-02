/**
 * Debug script: manually replicate the search pipeline for a single image + query
 * to diagnose why match percentages are low (~33%).
 */
import sharp from 'sharp';
import fs from 'fs/promises';

const API_KEY = 'REDACTED_API_KEY';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const TEST_IMAGE = '/home/jai/work/marketmint/V1/MM_BD/MarketMint_Backend/MM_POC_v2_video_gen/Template_images/downloaded_images/0189f41d-ddc61.png';
const QUERY = 'A person sitting on a chair';

// ---- Helpers ----

async function prepareImageBase64(filePath) {
  const buffer = await fs.readFile(filePath);
  const resized = await sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { base64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---- API calls ----

async function embedTextWith(model, text) {
  const res = await fetch(
    `${BASE_URL}/models/${model}:embedContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    }
  );
  if (!res.ok) throw new Error(`Text embed (${model}) failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embedding.values;
}

async function embedImageWith(model, filePath) {
  const { base64, mimeType } = await prepareImageBase64(filePath);
  const res = await fetch(
    `${BASE_URL}/models/${model}:embedContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ inline_data: { mime_type: mimeType, data: base64 } }] },
      }),
    }
  );
  if (!res.ok) throw new Error(`Image embed (${model}) failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embedding.values;
}

async function analyzeWithGemini(filePath) {
  const { base64, mimeType } = await prepareImageBase64(filePath);
  const res = await fetch(
    `${BASE_URL}/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: `Analyze this ad creative in detail. Return a JSON object with these exact fields:
{
  "layout": "detailed description of the ad layout",
  "imagery": "detailed description of what is visually depicted",
  "headline": "the main headline or tagline text visible in the ad, verbatim. Empty string if none",
  "offer": "what product, service, or value proposition is being promoted",
  "hook": "description of the visual/text hook used to grab attention",
  "structure": "layout and composition description",
  "target_audience": "inferred target demographic",
  "cta_description": "call-to-action analysis",
  "emotional_appeal": "emotional triggers used",
  "platform_fit": "which platforms this would work best on",
  "summary": "2-3 sentence overall analysis",
  "visual_description": "a literal, objective description of everything visible in the image — people (gender, ethnicity, pose, clothing, action such as sitting/standing/walking), objects, products, text, background, setting, colors",
  "search_tags": "comma-separated list of 10-20 descriptive tags",
  "suggested_brand": "brand name if visible, otherwise empty string"
}` },
          ],
        }],
        generationConfig: { response_mime_type: 'application/json' },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini analysis failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// ---- Main ----

async function main() {
  console.log('='.repeat(70));
  console.log('EMBEDDING DIAGNOSTIC');
  console.log(`Query: "${QUERY}"`);
  console.log(`Image: ${TEST_IMAGE}`);
  console.log('='.repeat(70));

  // Step 1: Analyze image with Gemini
  console.log('\n--- Step 1: Gemini 2.5 Flash Analysis ---');
  const analysis = await analyzeWithGemini(TEST_IMAGE);
  console.log('visual_description:', analysis.visual_description);
  console.log('search_tags:', analysis.search_tags);
  console.log('summary:', analysis.summary);
  console.log('imagery:', analysis.imagery);

  // Step 2: Build text for embedding (same as sync route)
  const textForEmbed = [
    analysis.visual_description || '',
    analysis.search_tags || '',
    analysis.imagery || '',
    analysis.layout || '',
    analysis.headline || '',
    analysis.offer || '',
    analysis.hook || '',
    analysis.summary || '',
    analysis.structure || '',
    analysis.emotional_appeal || '',
    analysis.target_audience || '',
    analysis.cta_description || '',
    analysis.suggested_brand || '',
  ].filter(Boolean).join(' ');

  console.log('\n--- Step 2: Text for embedding (first 300 chars) ---');
  console.log(textForEmbed.substring(0, 300) + '...');
  console.log(`Total length: ${textForEmbed.length} chars`);

  // Step 3: Generate embeddings with BOTH models for comparison
  console.log('\n--- Step 3: Generating embeddings ---');

  // Current approach: all using gemini-embedding-2-preview
  const [queryEmb2, imageEmb2, textEmb2] = await Promise.all([
    embedTextWith('gemini-embedding-2-preview', QUERY),
    embedImageWith('gemini-embedding-2-preview', TEST_IMAGE),
    embedTextWith('gemini-embedding-2-preview', textForEmbed),
  ]);

  console.log(`Query embedding (embedding-2): ${queryEmb2.length} dimensions`);
  console.log(`Image embedding (embedding-2): ${imageEmb2.length} dimensions`);
  console.log(`Text embedding  (embedding-2): ${textEmb2.length} dimensions`);

  // Old approach: query with embedding-001
  const queryEmb001 = await embedTextWith('gemini-embedding-001', QUERY);
  console.log(`Query embedding (embedding-001): ${queryEmb001.length} dimensions`);

  // Step 4: Compute similarities
  console.log('\n--- Step 4: Cosine Similarities ---');
  console.log('');

  const sim_q2_img2 = cosineSimilarity(queryEmb2, imageEmb2);
  const sim_q2_txt2 = cosineSimilarity(queryEmb2, textEmb2);
  const sim_q001_img2 = cosineSimilarity(queryEmb001, imageEmb2);
  const sim_q001_txt2 = cosineSimilarity(queryEmb001, textEmb2);

  // Also test embedding-001 text embedding for old pipeline comparison
  const oldTextForEmbed = [
    analysis.suggested_brand || '',
    analysis.hook || '',
    analysis.summary || '',
    analysis.target_audience || '',
    analysis.cta_description || '',
  ].filter(Boolean).join(' ');
  const textEmb001 = await embedTextWith('gemini-embedding-001', oldTextForEmbed);
  const sim_q001_txt001 = cosineSimilarity(queryEmb001, textEmb001);

  console.log('NEW PIPELINE (all gemini-embedding-2-preview):');
  console.log(`  query(text) vs image(visual) : ${(sim_q2_img2 * 100).toFixed(2)}%`);
  console.log(`  query(text) vs ad(text)      : ${(sim_q2_txt2 * 100).toFixed(2)}%`);
  const weightedNew = 0.6 * sim_q2_img2 + 0.4 * sim_q2_txt2;
  console.log(`  WEIGHTED (0.6v + 0.4t)       : ${(weightedNew * 100).toFixed(2)}%`);
  console.log('');

  console.log('OLD PIPELINE (query=embedding-001, image=embedding-2-preview):');
  console.log(`  query(001) vs image(2-prev)  : ${(sim_q001_img2 * 100).toFixed(2)}%`);
  console.log(`  query(001) vs ad-text(2-prev): ${(sim_q001_txt2 * 100).toFixed(2)}%`);
  const oldMax = Math.max(sim_q001_img2, sim_q001_txt2);
  console.log(`  MAX (old scoring)            : ${(oldMax * 100).toFixed(2)}%`);
  console.log('');

  console.log('FULLY OLD PIPELINE (all embedding-001):');
  console.log(`  query(001) vs ad-text(001)   : ${(sim_q001_txt001 * 100).toFixed(2)}%`);
  console.log('');

  // Step 5: Test with more descriptive queries
  console.log('--- Step 5: Alternative queries (all embedding-2-preview) ---');
  const altQueries = [
    'man sitting on chair',
    'man sitting on wooden chair blue shirt studio',
    'portrait of a man sitting',
    'fashion photography man seated',
    'studio portrait male model chair',
  ];

  for (const q of altQueries) {
    const qEmb = await embedTextWith('gemini-embedding-2-preview', q);
    const vSim = cosineSimilarity(qEmb, imageEmb2);
    const tSim = cosineSimilarity(qEmb, textEmb2);
    const w = 0.6 * vSim + 0.4 * tSim;
    console.log(`  "${q}"`);
    console.log(`    visual: ${(vSim * 100).toFixed(2)}%  text: ${(tSim * 100).toFixed(2)}%  weighted: ${(w * 100).toFixed(2)}%`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('DONE');
}

main().catch(console.error);
