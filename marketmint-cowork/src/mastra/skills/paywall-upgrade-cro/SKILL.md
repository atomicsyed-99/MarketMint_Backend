---
name: paywall-upgrade-cro
description: Use when the user wants to optimize in-app paywalls, upgrade screens, or trial-to-paid conversion (in-product upgrade moment). Do not use for public pricing pages—use page-cro for that.
---

# Paywall and Upgrade Screen CRO - Guidance Framework

**IMPORTANT: PAYWALL CRO CAPABILITIES**

This document provides **in-app paywall and upgrade flow optimization expertise**. The agent CAN write paywall copy, design upgrade flows, and provide recommendations, but does NOT have the capability to:
- Deploy paywalls automatically
- Modify product code directly
- Integrate with payment systems automatically
- Access user's product analytics directly
- Set up paywall triggers automatically

**What the agent WILL provide:**
- Complete paywall copy and design recommendations
- Upgrade flow design
- Trigger strategy recommendations
- Frequency and targeting rules
- Test hypotheses

**The user must implement the paywalls manually** using their own development team and product tools.

---

## When to Use This Reference

Use this reference when the user wants to:
- Create or optimize in-app paywalls, upgrade screens, upsell modals, or feature gates
- Mentions "paywall," "upgrade screen," "upgrade modal," "upsell," "feature gate," "convert free to paid," "freemium conversion," "trial expiration screen," "limit reached screen," "plan upgrade prompt," or "in-app pricing"

**Note**: 
- Distinct from public pricing pages (see `PAGE_CRO.md`) — this skill focuses on in-product upgrade moments where the user has already experienced value

---

## Your Role

You are an expert in in-app paywalls and upgrade flows. Your goal is to convert free users to paid, or upgrade users to higher tiers, at moments when they've experienced enough value to justify the commitment by providing:
1. Complete paywall copy and design
2. Upgrade flow design
3. Trigger strategy recommendations
4. Frequency and targeting rules
5. Test hypotheses

You will design the paywalls, but the user must implement them.

---

## Plan Generation (First Step)

**IMPORTANT**: Always start by generating and presenting a plan before proceeding with paywall design.

### Plan Format Requirements

1. **Present a brief, contextual plan** in formatted bullet points that:
   - Acknowledges what information the user has already provided (e.g., "You've mentioned creating paywalls for freemium conversion" or "You want to optimize your trial expiration paywall")
   - Adjusts the plan steps based on what's already known
   - Clearly outlines the paywall design approach

2. **Plan Structure**:
   - Start with acknowledgment: "Based on what you've shared..."
   - List 3-5 key steps you'll take (e.g., "Design paywall copy", "Define trigger strategy", "Set frequency rules", etc.)
   - Keep it concise and tailored to their specific request

3. **Example Plan Format**:
   ```
   Based on your request to create [specific paywall type], here's my plan:
   
   • Design paywall copy (headline, value demonstration, CTA, escape hatch)
   • Define trigger strategy and timing
   • Set frequency capping and targeting rules
   • Design upgrade flow from paywall to payment
   • Provide test hypotheses worth A/B testing
   ```

4. **After presenting the plan**, proceed with:
   - Initial assessment questions (if needed)
   - Paywall design
   - Trigger strategy
   - Implementation guidance

---

## Using External Links and Resources

**IMPORTANT**: When this reference mentions URLs or links (e.g., paywall tools, examples, resources), these are **for the USER to access**, not for the agent to visit.

### Link Usage Guidelines

- **Links are provided for user reference**: URLs mentioned in examples or resources are for the user to visit themselves
- **Agent does NOT visit links**: The agent cannot browse the web or access these URLs
- **Agent provides paywall design directly**: Use your paywall optimization knowledge to design paywalls, but direct users to resources for tools or examples if helpful
- **When sharing links**: Always clarify: "You can reference this resource: [URL] for additional paywall examples" or "Check out this tool: [URL] for paywall analytics"

---

## When to Use tavilySearch Tool

**IMPORTANT**: Use the `tavilySearch` tool proactively when research would improve the paywall design you provide.

### Use tavilySearch When:

1. **User asks for paywall best practices**:
   - "Best practices for [product type] paywalls"
   - "How do successful companies design upgrade screens?"

2. **User needs competitive paywall analysis**:
   - "How do competitors design their paywalls?"
   - "What paywall strategies do [competitor] use?"

3. **User asks about conversion strategies**:
   - "How do companies convert free users to paid?"
   - "What are proven freemium conversion strategies?"

### How to Use tavilySearch:

1. **Construct a specific query** that captures the research need
2. **Execute the tool** with the query parameter
3. **Analyze findings** for paywall patterns, best practices, or examples
4. **Integrate insights** into your recommendations (e.g., "Based on industry research, most successful [product type] paywalls use...")
5. **Cite sources** when sharing research findings

### Example tavilySearch Usage:

- Query: "Freemium paywall conversion optimization best practices"
- Query: "SaaS upgrade screen design strategies"
- Query: "Trial expiration paywall best practices"

**Note**: Do NOT use tavilySearch for basic paywall optimization principles you already know. Use it when the user's request requires industry-specific guidance, competitive insights, or current paywall trends.

---

## Initial Assessment

Before providing recommendations, understand:

1. **Upgrade Context**
   - Freemium → Paid conversion
   - Trial → Paid conversion
   - Tier upgrade (Basic → Pro)
   - Feature-specific upsell
   - Usage limit upsell

2. **Product Model**
   - What's free forever?
   - What's behind the paywall?
   - What triggers upgrade prompts?
   - What's the current conversion rate?

3. **User Journey**
   - At what point does this appear?
   - What have they experienced already?
   - What are they trying to do when blocked?

---

## Core Principles

### 1. Value Before Ask
- User should have experienced real value first
- The upgrade should feel like a natural next step
- Timing: After "aha moment," not before

### 2. Show, Don't Just Tell
- Demonstrate the value of paid features
- Preview what they're missing
- Make the upgrade feel tangible

### 3. Friction-Free Path
- Easy to upgrade when ready
- Don't make them hunt for pricing
- Remove barriers to conversion

### 4. Respect the No
- Don't trap or pressure
- Make it easy to continue free
- Maintain trust for future conversion

---

## Paywall Trigger Points

### Feature Gates
When user clicks a paid-only feature:
- Clear explanation of why it's paid
- Show what the feature does
- Quick path to unlock
- Option to continue without

### Usage Limits
When user hits a limit:
- Clear indication of what limit was reached
- Show what upgrading provides
- Option to buy more without full upgrade
- Don't block abruptly

### Trial Expiration
When trial is ending:
- Early warnings (7 days, 3 days, 1 day)
- Clear "what happens" on expiration
- Easy re-activation if expired
- Summarize value received

### Time-Based Prompts
After X days/sessions of free use:
- Gentle upgrade reminder
- Highlight unused paid features
- Not intrusive—banner or subtle modal
- Easy to dismiss

### Context-Triggered
When behavior indicates upgrade fit:
- Power users who'd benefit
- Teams using solo features
- Heavy usage approaching limits
- Inviting teammates

---

## Paywall Screen Components

### 1. Headline
Focus on what they get, not what they pay:
- "Unlock [Feature] to [Benefit]"
- "Get more [value] with [Plan]"
- Not: "Upgrade to Pro for $X/month"

### 2. Value Demonstration
Show what they're missing:
- Preview of the feature in action
- Before/after comparison
- "With Pro, you could..." examples
- Specific to their use case if possible

### 3. Feature Comparison
If showing tiers:
- Highlight key differences
- Current plan clearly marked
- Recommended plan emphasized
- Focus on outcomes, not feature lists

### 4. Pricing
- Clear, simple pricing
- Annual vs. monthly options
- Per-seat clarity if applicable
- Any trials or guarantees

### 5. Social Proof (Optional)
- Customer quotes about the upgrade
- "X teams use this feature"
- Success metrics from upgraded users

### 6. CTA
- Specific: "Upgrade to Pro" not "Upgrade"
- Value-oriented: "Start Getting [Benefit]"
- If trial: "Start Free Trial"

### 7. Escape Hatch
- Clear "Not now" or "Continue with Free"
- Don't make them feel bad
- "Maybe later" vs. "No, I'll stay limited"

---

## Specific Paywall Types

### Feature Lock Paywall
When clicking a paid feature:

```
[Lock Icon]
This feature is available on Pro

[Feature preview/screenshot]

[Feature name] helps you [benefit]:
• [Specific capability]
• [Specific capability]
• [Specific capability]

[Upgrade to Pro - $X/mo]
[Maybe Later]
```

### Usage Limit Paywall
When hitting a limit:

```
You've reached your free limit

[Visual: Progress bar at 100%]

Free plan: 3 projects
Pro plan: Unlimited projects

You're active! Upgrade to keep building.

[Upgrade to Pro]    [Delete a project]
```

### Trial Expiration Paywall
When trial is ending:

```
Your trial ends in 3 days

What you'll lose:
• [Feature they've used]
• [Feature they've used]
• [Data/work they've created]

What you've accomplished:
• Created X projects
• [Specific value metric]

[Continue with Pro - $X/mo]
[Remind me later]    [Downgrade to Free]
```

### Soft Upgrade Prompt
Non-blocking suggestion:

```
[Banner or subtle modal]

You've been using [Product] for 2 weeks!
Teams like yours get X% more [value] with Pro.

[See Pro Features]    [Dismiss]
```

### Team/Seat Upgrade
When adding users:

```
Invite your team

Your plan: Solo (1 user)
Team plans start at $X/user

• Shared projects
• Collaboration features
• Admin controls

[Upgrade to Team]    [Continue Solo]
```

---

## Mobile Paywall Patterns

### iOS/Android Conventions
- System-like styling builds trust
- Standard paywall patterns users recognize
- Free trial emphasis common
- Subscription terminology they expect

### Mobile-Specific UX
- Full-screen often acceptable
- Swipe to dismiss
- Large tap targets
- Plan selection with clear visual state

### App Store Considerations
- Clear pricing display
- Subscription terms visible
- Restore purchases option
- Meet review guidelines

---

## Timing and Frequency

### When to Show
- **Best**: After value moment, before frustration
- After activation/aha moment
- When hitting genuine limits
- When using adjacent-to-paid features

### When NOT to Show
- During onboarding (too early)
- When they're in a flow
- Repeatedly after dismissal
- Before they understand the product

### Frequency Rules
- Limit to X per session
- Cool-down after dismiss (days, not hours)
- Escalate urgency appropriately (trial end)
- Track annoyance signals (rage clicks, churn)

---

## Upgrade Flow Optimization

### From Paywall to Payment
- Minimize steps
- Keep them in-context if possible
- Pre-fill known information
- Show security signals

### Plan Selection
- Default to recommended plan
- Annual vs. monthly clear trade-off
- Feature comparison if helpful
- FAQ or objection handling nearby

### Checkout
- Minimal fields
- Multiple payment methods
- Trial terms clear
- Easy cancellation visible (builds trust)

### Post-Upgrade
- Immediate access to features
- Confirmation and receipt
- Guide to new features
- Celebrate the upgrade

---

## A/B Testing Paywalls

### What to Test
- Trigger timing (earlier vs. later)
- Trigger type (feature gate vs. soft prompt)
- Headline/copy variations
- Price presentation
- Trial length
- Feature emphasis
- Social proof presence
- Design/layout

### Metrics to Track
- Paywall impression rate
- Click-through to upgrade
- Upgrade completion rate
- Revenue per user
- Churn rate post-upgrade
- Time to upgrade

---

## Output Format

### Paywall Design
For each paywall:
- **Trigger**: When it appears
- **Context**: What user was doing
- **Type**: Feature gate, limit, trial, etc.
- **Copy**: Full copy with headline, body, CTA
- **Design notes**: Layout, visual elements
- **Mobile**: Mobile-specific considerations
- **Frequency**: How often shown
- **Exit path**: How to dismiss

### Upgrade Flow
- Step-by-step screens
- Copy for each step
- Decision points
- Success state

### Metrics Plan
What to measure and expected benchmarks

---

## Common Patterns by Business Model

### Freemium SaaS
- Generous free tier to build habit
- Feature gates for power features
- Usage limits for volume
- Soft prompts for heavy free users

### Free Trial
- Trial countdown prominent
- Value summary at expiration
- Grace period or easy restart
- Win-back for expired trials

### Usage-Based
- Clear usage tracking
- Alerts at thresholds (75%, 100%)
- Easy to add more without plan change
- Volume discounts visible

### Per-Seat
- Friction at invitation
- Team feature highlights
- Volume pricing clear
- Admin value proposition

---

## Anti-Patterns to Avoid

### Dark Patterns
- Hiding the close button
- Confusing plan selection
- Buried downgrade option
- Misleading urgency
- Guilt-trip copy

### Conversion Killers
- Asking before value delivered
- Too frequent prompts
- Blocking critical flows
- Unclear pricing
- Complicated upgrade process

### Trust Destroyers
- Surprise charges
- Hard-to-cancel subscriptions
- Bait and switch
- Data hostage tactics

---

## Experiment Ideas

### Trigger & Timing Experiments

**When to Show**
- Test trigger timing: after aha moment vs. at feature attempt
- Early trial reminder (7 days) vs. late reminder (1 day before)
- Show after X actions completed vs. after X days
- Test soft prompts at different engagement thresholds
- Trigger based on usage patterns vs. time-based only

**Trigger Type**
- Hard gate (can't proceed) vs. soft gate (preview + prompt)
- Feature lock vs. usage limit as primary trigger
- In-context modal vs. dedicated upgrade page
- Banner reminder vs. modal prompt
- Exit-intent on free plan pages

---

### Paywall Design Experiments

**Layout & Format**
- Full-screen paywall vs. modal overlay
- Minimal paywall (CTA-focused) vs. feature-rich paywall
- Single plan display vs. plan comparison
- Image/preview included vs. text-only
- Vertical layout vs. horizontal layout on desktop

**Value Presentation**
- Feature list vs. benefit statements
- Show what they'll lose (loss aversion) vs. what they'll gain
- Personalized value summary based on usage
- Before/after demonstration
- ROI calculator or value quantification

**Visual Elements**
- Add product screenshots or previews
- Include short demo video or GIF
- Test illustration vs. product imagery
- Animated vs. static paywall
- Progress visualization (what they've accomplished)

---

### Pricing Presentation Experiments

**Price Display**
- Show monthly vs. annual vs. both with toggle
- Highlight savings for annual ($ amount vs. % off)
- Price per day framing ("Less than a coffee")
- Show price after trial vs. emphasize "Start Free"
- Display price prominently vs. de-emphasize until click

**Plan Options**
- Single recommended plan vs. multiple tiers
- Add "Most Popular" badge to target plan
- Test number of visible plans (2 vs. 3)
- Show enterprise/custom tier vs. hide it
- Include one-time purchase option alongside subscription

**Discounts & Offers**
- First month/year discount for conversion
- Limited-time upgrade offer with countdown
- Loyalty discount based on free usage duration
- Bundle discount for annual commitment
- Referral discount for social proof

---

### Copy & Messaging Experiments

**Headlines**
- Benefit-focused ("Unlock unlimited projects") vs. feature-focused ("Get Pro features")
- Question format ("Ready to do more?") vs. statement format
- Urgency-based ("Don't lose your work") vs. value-based
- Personalized headline with user's name or usage data
- Social proof headline ("Join 10,000+ Pro users")

**CTAs**
- "Start Free Trial" vs. "Upgrade Now" vs. "Continue with Pro"
- First person ("Start My Trial") vs. second person ("Start Your Trial")
- Value-specific ("Unlock Unlimited") vs. generic ("Upgrade")
- Add urgency ("Upgrade Today") vs. no pressure
- Include price in CTA vs. separate price display

**Objection Handling**
- Add money-back guarantee messaging
- Show "Cancel anytime" prominently
- Include FAQ on paywall
- Address specific objections based on feature gated
- Add chat/support option on paywall

---

### Trial & Conversion Experiments

**Trial Structure**
- 7-day vs. 14-day vs. 30-day trial length
- Credit card required vs. not required for trial
- Full-access trial vs. limited feature trial
- Trial extension offer for engaged users
- Second trial offer for expired/churned users

**Trial Expiration**
- Countdown timer visibility (always vs. near end)
- Email reminders: frequency and timing
- Grace period after expiration vs. immediate downgrade
- "Last chance" offer with discount
- Pause option vs. immediate cancellation

**Upgrade Path**
- One-click upgrade from paywall vs. separate checkout
- Pre-filled payment info for returning users
- Multiple payment methods offered
- Quarterly plan option alongside monthly/annual
- Team invite flow for solo-to-team conversion

---

### Personalization Experiments

**Usage-Based**
- Personalize paywall copy based on features used
- Highlight most-used premium features
- Show usage stats ("You've created 50 projects")
- Recommend plan based on behavior patterns
- Dynamic feature emphasis based on user segment

**Segment-Specific**
- Different paywall for power users vs. casual users
- B2B vs. B2C messaging variations
- Industry-specific value propositions
- Role-based feature highlighting
- Traffic source-based messaging

---

### Frequency & UX Experiments

**Frequency Capping**
- Test number of prompts per session
- Cool-down period after dismiss (hours vs. days)
- Escalating urgency over time vs. consistent messaging
- Once per feature vs. consolidated prompts
- Re-show rules after major engagement

**Dismiss Behavior**
- "Maybe later" vs. "No thanks" vs. "Remind me tomorrow"
- Ask reason for declining
- Offer alternative (lower tier, annual discount)
- Exit survey on dismiss
- Friendly vs. neutral decline copy

---

## Questions to Ask

If you need more context:
1. What's your current free → paid conversion rate?
2. What triggers upgrade prompts today?
3. What features are behind the paywall?
4. What's your "aha moment" for users?
5. What pricing model? (per seat, usage, flat)
6. Mobile app, web app, or both?

---

## Related Skills

- **page-cro**: For public pricing page optimization
- **onboarding-cro**: For driving to aha moment before upgrade
- **ab-test-setup**: For testing paywall variations
- **analytics-tracking**: For measuring upgrade funnel

---

## What You Can Provide vs. What User Must Do

### What You Provide (Paywall Design)

- Complete paywall copy and design recommendations
- Upgrade flow design
- Trigger strategy recommendations
- Frequency and targeting rules
- Test hypotheses

### What User Must Do (Implementation)

- Implement paywalls in product
- Deploy copy and design changes
- Set up triggers and targeting rules
- Configure payment integration
- Set up analytics and tracking
- Run A/B tests
- Monitor and optimize performance

---

## Example Agent Workflow

**User**: "I need paywalls to convert my free users to paid"

**Agent should**:
1. Present a plan: "Based on your request, I'll design paywalls for different trigger points, write complete copy, define trigger strategies, set frequency rules, and provide test hypotheses..."
2. Ask context questions (if needed): product model, current conversion rate, trigger points
3. Design paywalls:
   - Feature gate paywall
   - Usage limit paywall
   - Trial expiration paywall
   - Soft upgrade prompt
4. Provide complete paywall designs with:
   - Full copy for each paywall type
   - Trigger strategies
   - Frequency rules
   - Upgrade flow design
   - Test hypotheses
5. **Make it clear**: "Here's your complete paywall strategy ready to implement. You'll need to build these paywalls in your product, deploy the copy, set up the triggers, integrate with your payment system, and configure analytics to track conversion..."
