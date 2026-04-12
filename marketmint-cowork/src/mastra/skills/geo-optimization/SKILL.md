---
name: geo-optimization
description: Use when the user asks to improve LLM visibility, AI-search citations, or ranking on providers like ChatGPT, Perplexity, and Gemini.
---

# GEO Optimization - Operating Guide

## Scope

This skill helps the agent improve brand discoverability in LLM answer surfaces.

Primary goals:
- Identify high-intent user questions (prompts) to track.
- Audit whether the brand is cited in LLM-style answer flows.
- Produce citation-friendly content assets to improve future inclusion.

## GEO Principles

- **Prompt-first strategy**: start from what users ask, not what the brand wants to publish.
- **Evidence-first writing**: use clear facts, precise claims, and verifiable details.
- **Provider diversity**: track performance across multiple providers, not one.
- **Iteration loop**: extract prompts -> audit citations -> publish improved content -> re-audit.
- **Consistency over spikes**: stable daily/weekly tracking matters more than one-off wins.

## Onboarding Behavior

Use a guided first-run workflow, then switch to user-driven mode.

### First-run guided workflow
1. Confirm brand memory toggle is enabled.
2. Extract/store prompts from brand memory.
3. Suggest and run first audit when user confirms.
4. Deliver audit report (PDF artifact).
5. Suggest daily monitoring job.
6. Suggest content generation for weak prompts.

### Post-onboarding workflow
- Do only what the user requests.
- Do not auto-run audits or content generation.
- Keep suggestions brief and contextual.

## Prompt Extraction Rules

- Generate one-line, real-user phrasing.
- Prioritize intent buckets:
  - Trust/safety
  - Quality/performance
  - Price/value
  - Warranty/policy
  - Comparisons/alternatives
  - Fit/use-case
- Keep prompt set balanced:
  - 30-40% bottom-funnel
  - 30-40% mid-funnel evaluation
  - 20-30% trust/objection handling

## Audit Interpretation Rules

For each prompt/provider result, capture:
- cited/not-cited
- citation position (if available)
- source URL (if available)
- short response snippet

Then summarize:
- citation rate per provider
- strongest prompts (already cited)
- weak prompts (not cited)
- priority prompts to improve next

## Content Generation Rules

When generating GEO content for a prompt:
- Lead with the direct answer in 1-3 lines.
- Include short factual sections that answer follow-up questions.
- Add clear policy details (warranty, returns, safety) when relevant.
- Avoid vague superlatives without support.
- Keep structure easy for chunking/citation:
  - direct answer
  - key facts
  - quick comparison
  - FAQ

## Output Expectations

- Use artifacts for durable deliverables:
  - markdown for editable content
  - PDF for shareable audit/content snapshots
- Keep chat replies concise; put dense output in artifacts.
- Persist prompts and audit outputs by workspace so progress survives chat sessions.
