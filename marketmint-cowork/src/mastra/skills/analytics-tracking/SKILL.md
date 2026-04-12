---
name: analytics-tracking
description: Use when the user wants to set up, improve, or audit analytics tracking (GA4, GTM, events, UTM, tracking plan, implementation). Do not use for A/B test design—use ab-test-setup for that.
---

# Analytics Tracking - Guidance Framework

**IMPORTANT: GUIDANCE ONLY**

This document provides **strategic guidance, frameworks, and implementation recommendations** for analytics tracking. The agent does NOT have the capability to:
- Deploy tracking code to websites automatically
- Integrate with Google Analytics or Tag Manager APIs
- Modify website files or inject JavaScript
- Set up GTM containers, tags, or triggers
- Access or validate tracking in real-time
- Connect to user's analytics accounts

**What the agent WILL provide:**
- Tracking plan frameworks and templates
- Event naming conventions and best practices
- Code snippets ready to copy/paste
- Implementation step-by-step guides
- Validation checklists
- UTM parameter strategies
- Privacy/compliance guidance

**The user must implement the code and set up tracking manually** using their own development team, GTM dashboard, or analytics tools.

---

## When to Use This Reference

Use this reference when the user wants to:
- Set up, improve, or audit analytics tracking and measurement
- Mentions "set up tracking," "GA4," "Google Analytics," "conversion tracking," "event tracking," "UTM parameters," "tag manager," "GTM," "analytics implementation," or "tracking plan"
- Needs help planning what to track and how to name events
- Wants code snippets for tracking implementation

For A/B test measurement, see `AB_TEST_SETUP.md`.

---

## Your Role

You are an expert in analytics implementation and measurement. Your goal is to help set up tracking that provides actionable insights by providing:
1. Tracking plan frameworks
2. Event naming conventions
3. Code snippets and implementation guides
4. Validation checklists
5. Best practices and recommendations

You will guide the user through the process, but they must execute the actual implementation.

---

## Plan Generation (First Step)

**IMPORTANT**: Always start by generating and presenting a plan before proceeding with any guidance or questions.

### Plan Format Requirements

1. **Present a brief, contextual plan** in formatted bullet points that:
   - Acknowledges what information the user has already provided (e.g., "You've mentioned setting up GA4 tracking for your e-commerce site")
   - Adjusts the plan steps based on what's already known
   - Clearly outlines the steps you'll follow to help them set up tracking

2. **Plan Structure**:
   - Start with acknowledgment: "Based on what you've shared..."
   - List 3-5 key steps you'll take (e.g., "Create a tracking plan", "Define event naming conventions", "Provide code snippets", etc.)
   - Keep it concise and tailored to their specific request

3. **Example Plan Format**:
   ```
   Based on your request to set up [specific tracking], here's my plan:
   
   • Create a comprehensive tracking plan for your key events
   • Establish event naming conventions for consistency
   • Provide ready-to-use code snippets for implementation
   • Guide you through validation and testing steps
   • Ensure privacy/compliance considerations are addressed
   ```

4. **After presenting the plan**, proceed with:
   - Initial assessment questions (if needed)
   - Tracking plan creation
   - Event naming guidance
   - Code snippet generation
   - Implementation recommendations

---

## Using External Links and Resources

**IMPORTANT**: When this reference mentions URLs or links (e.g., Google Analytics documentation, UTM builders, code examples), these are **for the USER to access**, not for the agent to visit.

### Link Usage Guidelines

- **Links are provided for user reference**: URLs like `https://support.google.com/analytics/answer/9267735` or `https://ga-dev-tools.google/campaign-url-builder/` are resources the user should visit themselves
- **Agent does NOT visit links**: The agent cannot browse the web or access these URLs
- **Agent provides guidance**: Use your knowledge to explain concepts and provide code snippets, but direct users to these resources for official documentation or tools
- **When sharing links**: Always clarify: "You can refer to Google's documentation here: [URL] for official implementation details" or "Use this UTM builder tool: [URL] to generate your campaign URLs"

---

## When to Use tavilySearch Tool

**IMPORTANT**: Use the `tavilySearch` tool proactively when research would improve the guidance you provide.

### Use tavilySearch When:

1. **User asks for best practices**:
   - "What are best practices for tracking [specific event type]?"
   - "How should I structure event names for [industry/use case]?"

2. **User needs implementation examples**:
   - "How do e-commerce sites track [specific action] in GA4?"
   - "Show me examples of tracking [specific funnel]"

3. **User asks about specific tools or platforms**:
   - "How does [tool name] handle [specific feature]?"
   - "What are the differences between GA4 and [other tool]?"

4. **User wants competitive insights**:
   - "How do competitors track [specific metric]?"
   - "What tracking strategies do [industry] companies use?"

5. **User needs compliance/privacy guidance**:
   - "GDPR compliant tracking implementation"
   - "CCPA requirements for analytics tracking"

6. **User asks about industry benchmarks**:
   - "What's a typical conversion rate for [industry]?"
   - "How do SaaS companies track user activation?"

### How to Use tavilySearch:

1. **Construct a specific query** that captures the user's research need
2. **Execute the tool** with the query parameter
3. **Summarize relevant findings** from the search results
4. **Integrate insights** into your guidance (e.g., "Based on industry research, most e-commerce sites track add-to-cart events with these properties...")
5. **Cite sources** when sharing research findings

### Example tavilySearch Usage:

- Query: "GA4 e-commerce tracking implementation best practices"
- Query: "Event naming conventions for SaaS product analytics"
- Query: "GDPR compliant Google Analytics 4 setup"
- Query: "How to track user activation funnel in Mixpanel"

**Note**: Do NOT use tavilySearch for basic concepts you already know. Use it when the user's question requires current industry knowledge, specific tool information, competitive insights, or compliance requirements.

---

## Initial Assessment

Before creating a tracking plan, gather this context:

### 1. Business Context
- What decisions will this data inform?
- What are the key conversion actions?
- What questions need answering?

### 2. Current State
- What tracking exists?
- What tools are in use (GA4, Mixpanel, Amplitude, etc.)?
- What's working/not working?

### 3. Technical Context
- What's the tech stack?
- Who will implement and maintain?
- Any privacy/compliance requirements?

---

## Core Principles

### 1. Track for Decisions, Not Data
- Every event should inform a decision
- Avoid vanity metrics
- Quality > quantity of events

### 2. Start with the Questions
- What do you need to know?
- What actions will you take based on this data?
- Work backwards to what you need to track

### 3. Name Things Consistently
- Naming conventions matter
- Establish patterns before implementing
- Document everything

### 4. Maintain Data Quality
- Validate implementation
- Monitor for issues
- Clean data > more data

---

## Tracking Plan Framework

### Structure

```
Event Name | Event Category | Properties | Trigger | Notes
---------- | ------------- | ---------- | ------- | -----
```

### Event Types

**Pageviews**
- Automatic in most tools
- Enhanced with page metadata

**User Actions**
- Button clicks
- Form submissions
- Feature usage
- Content interactions

**System Events**
- Signup completed
- Purchase completed
- Subscription changed
- Errors occurred

**Custom Conversions**
- Goal completions
- Funnel stages
- Business-specific milestones

---

## Event Naming Conventions

### Format Options

**Object-Action (Recommended)**
```
signup_completed
button_clicked
form_submitted
article_read
```

**Action-Object**
```
click_button
submit_form
complete_signup
```

**Category_Object_Action**
```
checkout_payment_completed
blog_article_viewed
onboarding_step_completed
```

### Best Practices

- Lowercase with underscores
- Be specific: `cta_hero_clicked` vs. `button_clicked`
- Include context in properties, not event name
- Avoid spaces and special characters
- Document decisions

---

## Essential Events to Track

### Marketing Site

**Navigation**
- page_view (enhanced)
- outbound_link_clicked
- scroll_depth (25%, 50%, 75%, 100%)

**Engagement**
- cta_clicked (button_text, location)
- video_played (video_id, duration)
- form_started
- form_submitted (form_type)
- resource_downloaded (resource_name)

**Conversion**
- signup_started
- signup_completed
- demo_requested
- contact_submitted

### Product/App

**Onboarding**
- signup_completed
- onboarding_step_completed (step_number, step_name)
- onboarding_completed
- first_key_action_completed

**Core Usage**
- feature_used (feature_name)
- action_completed (action_type)
- session_started
- session_ended

**Monetization**
- trial_started
- pricing_viewed
- checkout_started
- purchase_completed (plan, value)
- subscription_cancelled

### E-commerce

**Browsing**
- product_viewed (product_id, category, price)
- product_list_viewed (list_name, products)
- product_searched (query, results_count)

**Cart**
- product_added_to_cart
- product_removed_from_cart
- cart_viewed

**Checkout**
- checkout_started
- checkout_step_completed (step)
- payment_info_entered
- purchase_completed (order_id, value, products)

---

## Event Properties (Parameters)

### Standard Properties to Consider

**Page/Screen**
- page_title
- page_location (URL)
- page_referrer
- content_group

**User**
- user_id (if logged in)
- user_type (free, paid, admin)
- account_id (B2B)
- plan_type

**Campaign**
- source
- medium
- campaign
- content
- term

**Product** (e-commerce)
- product_id
- product_name
- category
- price
- quantity
- currency

**Timing**
- timestamp
- session_duration
- time_on_page

### Best Practices

- Use consistent property names
- Include relevant context
- Don't duplicate GA4 automatic properties
- Avoid PII in properties
- Document expected values

---

## GA4 Implementation Guidance

### Configuration

**Data Streams**
- One stream per platform (web, iOS, Android)
- Enable enhanced measurement

**Enhanced Measurement Events**
- page_view (automatic)
- scroll (90% depth)
- outbound_click
- site_search
- video_engagement
- file_download

**Recommended Events**
- Use Google's predefined events when possible
- Correct naming for enhanced reporting
- **Reference**: https://support.google.com/analytics/answer/9267735 (User should visit this link for official Google documentation - agent does not access URLs)

### Custom Events (GA4) - Code Snippets

**Provide these code snippets to the user:**

```javascript
// gtag.js - Basic event tracking
gtag('event', 'signup_completed', {
  'method': 'email',
  'plan': 'free'
});

// gtag.js - Enhanced e-commerce
gtag('event', 'purchase', {
  'transaction_id': 'T12345',
  'value': 99.99,
  'currency': 'USD',
  'items': [{
    'item_id': 'SKU123',
    'item_name': 'Product Name',
    'price': 99.99,
    'quantity': 1
  }]
});
```

**Implementation Note**: User must add these code snippets to their website. Provide clear instructions on where to place them.

### Conversions Setup

**Guide the user through:**
1. Collect event in GA4
2. Mark as conversion in Admin > Events
3. Set conversion counting (once per session or every time)
4. Import to Google Ads if needed

**Note**: Agent cannot access GA4 dashboard. Provide step-by-step instructions.

### Custom Dimensions and Metrics

**When to use:**
- Properties you want to segment by
- Metrics you want to aggregate
- Beyond standard parameters

**Setup instructions:**
1. Create in Admin > Custom definitions
2. Scope: Event, User, or Item
3. Parameter name must match

---

## Google Tag Manager Implementation Guidance

### Container Structure

**Tags**
- GA4 Configuration (base)
- GA4 Event tags (one per event or grouped)
- Conversion pixels (Facebook, LinkedIn, etc.)

**Triggers**
- Page View (DOM Ready, Window Loaded)
- Click - All Elements / Just Links
- Form Submission
- Custom Events

**Variables**
- Built-in: Click Text, Click URL, Page Path, etc.
- Data Layer variables
- JavaScript variables
- Lookup tables

### Best Practices

- Use folders to organize
- Consistent naming (Tag_Type_Description)
- Version notes on every publish
- Preview mode for testing
- Workspaces for team collaboration

### Data Layer Pattern - Code Snippets

**Provide these code snippets:**

```javascript
// Push custom event
dataLayer.push({
  'event': 'form_submitted',
  'form_name': 'contact',
  'form_location': 'footer'
});

// Set user properties
dataLayer.push({
  'user_id': '12345',
  'user_type': 'premium'
});

// E-commerce event
dataLayer.push({
  'event': 'purchase',
  'ecommerce': {
    'transaction_id': 'T12345',
    'value': 99.99,
    'currency': 'USD',
    'items': [{
      'item_id': 'SKU123',
      'item_name': 'Product Name',
      'price': 99.99
    }]
  }
});
```

**Implementation Note**: User must add these to their website code. GTM tags/triggers must be set up manually in GTM dashboard.

---

## UTM Parameter Strategy

### Standard Parameters

| Parameter | Purpose | Example |
|-----------|---------|---------|
| utm_source | Where traffic comes from | google, facebook, newsletter |
| utm_medium | Marketing medium | cpc, email, social, referral |
| utm_campaign | Campaign name | spring_sale, product_launch |
| utm_content | Differentiate versions | hero_cta, sidebar_link |
| utm_term | Paid search keywords | running+shoes |

### Naming Conventions

**Lowercase everything**
- google, not Google
- email, not Email

**Use underscores or hyphens consistently**
- product_launch or product-launch
- Pick one, stick with it

**Be specific but concise**
- blog_footer_cta, not cta1
- 2024_q1_promo, not promo

### UTM Documentation Template

Provide this template to track UTMs:

```
Campaign | Source | Medium | Content | Full URL | Owner | Date
---------|--------|--------|---------|----------|-------|------
...      | ...    | ...    | ...     | ...      | ...   | ...
```

### UTM Builder Resources

**Note**: These are external tools for the user to access. The agent does not visit these URLs.

- Google's URL builder: https://ga-dev-tools.google/campaign-url-builder/
- Recommend creating internal tool or spreadsheet formula

When sharing this link, tell the user: "You can use Google's UTM Builder at [URL] to generate properly formatted campaign URLs with UTM parameters."

---

## Debugging and Validation

### Testing Tools (User Must Use)

**GA4 DebugView**
- Real-time event monitoring
- Enable with ?debug_mode=true
- Or via Chrome extension

**GTM Preview Mode**
- Test triggers and tags
- See data layer state
- Validate before publish

**Browser Extensions**
- GA Debugger
- Tag Assistant
- dataLayer Inspector

### Validation Checklist

Provide this checklist to the user:

- [ ] Events firing on correct triggers
- [ ] Property values populating correctly
- [ ] No duplicate events
- [ ] Works across browsers
- [ ] Works on mobile
- [ ] Conversions recorded correctly
- [ ] User ID passing when logged in
- [ ] No PII leaking

**Note**: Agent cannot validate tracking. User must use these tools themselves.

### Common Issues and Solutions

**Events not firing**
- Trigger misconfigured
- Tag paused
- GTM not loaded on page

**Wrong values**
- Variable not configured
- Data layer not pushing correctly
- Timing issues (fire before data ready)

**Duplicate events**
- Multiple GTM containers
- Multiple tag instances
- Trigger firing multiple times

---

## Privacy and Compliance

### Considerations

- Cookie consent required in EU/UK/CA
- No PII in analytics properties
- Data retention settings
- User deletion capabilities
- Cross-device tracking consent

### Implementation Guidance

**Consent Mode (GA4)**
- Wait for consent before tracking
- Use consent mode for partial tracking
- Integrate with consent management platform

**Data Minimization**
- Only collect what you need
- IP anonymization
- No PII in custom dimensions

**Note**: Agent cannot implement consent management. Provide guidance on what to set up.

---

## Output Format

### Tracking Plan Document Template

When providing guidance, structure it as:

```
# [Site/Product] Tracking Plan

## Overview
- Tools: GA4, GTM
- Last updated: [Date]
- Owner: [Name]

## Events

### Marketing Events

| Event Name | Description | Properties | Trigger |
|------------|-------------|------------|---------|
| signup_started | User initiates signup | source, page | Click signup CTA |
| signup_completed | User completes signup | method, plan | Signup success page |

### Product Events
[Similar table]

## Custom Dimensions

| Name | Scope | Parameter | Description |
|------|-------|-----------|-------------|
| user_type | User | user_type | Free, trial, paid |

## Conversions

| Conversion | Event | Counting | Google Ads |
|------------|-------|----------|------------|
| Signup | signup_completed | Once per session | Yes |

## UTM Convention
[Guidelines]

## Implementation Code
[Code snippets with clear instructions]

## Testing Checklist
[Validation steps]
```

### Implementation Code Section

For each event, provide:

1. **Code snippet** (ready to copy)
2. **Where to place it** (specific file/location)
3. **When it fires** (trigger description)
4. **How to test** (validation steps)

Example:
```
## Event: signup_completed

**Code to add:**
```javascript
gtag('event', 'signup_completed', {
  'method': 'email',
  'plan': 'free'
});
```

**Where to add:**
- File: `/pages/signup-success.js`
- Location: After successful signup API call
- Trigger: When signup API returns success

**How to test:**
1. Complete signup flow
2. Open GA4 DebugView
3. Verify event appears with correct properties
```

---

## Research Capabilities

**Note**: See the "When to Use tavilySearch Tool" section above for detailed guidelines on when and how to use research capabilities.

### Using tavilySearch Tool

The agent can research:
- How competitors implement tracking
- Industry best practices for event naming
- GA4 implementation examples
- Privacy compliance requirements

**Example research queries:**
- "How do e-commerce sites track add to cart events in GA4"
- "Best practices for tracking SaaS signup funnels"
- "GDPR compliant analytics tracking implementation"

**Remember**: Always use tavilySearch proactively when research would enhance your guidance, especially for industry-specific questions, tool comparisons, or compliance requirements.

---

## Questions to Ask User

If you need more context, ask:

1. What tools are you using (GA4, Mixpanel, etc.)?
2. What key actions do you want to track?
3. What decisions will this data inform?
4. Who implements - dev team or marketing?
5. Are there privacy/consent requirements?
6. What's already tracked?

---

## Related Skills

- **ab-test-setup**: For experiment tracking
- **seo-audit**: For organic traffic analysis
- **page-cro**: For conversion optimization (uses this data)

---

## What You Can Provide vs. What User Must Do

### What You Provide (Guidance)
- Tracking plan frameworks
- Event naming conventions
- Code snippets ready to copy
- Implementation step-by-step guides
- Validation checklists
- UTM parameter strategies
- Privacy/compliance guidance
- Research on best practices (via tavilySearch)

### What User Must Do (Execution)
- Implement code snippets in their application
- Set up GTM containers, tags, and triggers manually
- Configure GA4 conversions and custom dimensions
- Validate tracking using GA4 DebugView or GTM Preview
- Set up consent management
- Integrate with their analytics accounts
- Deploy changes to production

---

## Example Agent Workflow

**User**: "Help me set up tracking for my signup flow"

**Agent should**:
1. Ask initial assessment questions (tools, key actions, decisions)
2. Create tracking plan with events and properties
3. Provide code snippets for each event
4. Give step-by-step implementation guide
5. Provide validation checklist
6. Offer to research best practices if needed
7. **Make it clear**: "Here are the code snippets. You'll need to add them to your signup flow code. For GTM setup, you'll need to create tags/triggers in your GTM dashboard. Here's how..."

---

## Implementation Guide Template

For each tracking requirement, provide:

### Step 1: Planning
- [ ] Identify events to track
- [ ] Define properties for each event
- [ ] Document naming conventions
- [ ] Create tracking plan document

### Step 2: Code Implementation
- [ ] Add GA4 base code (if not already present)
- [ ] Add event tracking code to appropriate locations
- [ ] Test code syntax
- [ ] Deploy to staging environment

### Step 3: GTM Setup (if using GTM)
- [ ] Create GA4 Configuration tag
- [ ] Create event tags for each custom event
- [ ] Set up triggers
- [ ] Configure variables
- [ ] Test in Preview mode

### Step 4: GA4 Configuration
- [ ] Verify events are receiving data
- [ ] Mark conversions in GA4 Admin
- [ ] Set up custom dimensions/metrics
- [ ] Configure data retention

### Step 5: Validation
- [ ] Test each event fires correctly
- [ ] Verify property values
- [ ] Check for duplicates
- [ ] Validate across browsers/devices
- [ ] Confirm conversions recording

### Step 6: Documentation
- [ ] Document tracking plan
- [ ] Update implementation guide
- [ ] Share with team
- [ ] Set up monitoring alerts

---

## Code Snippet Examples

### GA4 Event Tracking

```javascript
// Basic event
gtag('event', 'button_clicked', {
  'button_text': 'Get Started',
  'button_location': 'hero'
});

// E-commerce purchase
gtag('event', 'purchase', {
  'transaction_id': 'T12345',
  'value': 99.99,
  'currency': 'USD',
  'items': [{
    'item_id': 'SKU123',
    'item_name': 'Product Name',
    'category': 'Electronics',
    'price': 99.99,
    'quantity': 1
  }]
});

// User properties
gtag('set', 'user_properties', {
  'user_type': 'premium',
  'plan': 'pro'
});
```

### GTM Data Layer

```javascript
// Custom event
dataLayer.push({
  'event': 'form_submitted',
  'form_name': 'contact',
  'form_location': 'footer',
  'form_fields': 5
});

// E-commerce
dataLayer.push({
  'event': 'purchase',
  'ecommerce': {
    'transaction_id': 'T12345',
    'value': 99.99,
    'currency': 'USD',
    'items': [{
      'item_id': 'SKU123',
      'item_name': 'Product Name',
      'price': 99.99,
      'quantity': 1
    }]
  }
});
```

**Note**: User must add these to their codebase. Provide clear file locations and trigger conditions.
