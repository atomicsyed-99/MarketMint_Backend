---
name: programmatic-seo
description: Use when the user wants to build SEO pages at scale (templates, directory/location pages, comparison pages). Do not use for auditing existing SEO—use seo-audit for that.
---

# Programmatic SEO - Guidance Framework

**IMPORTANT: PROGRAMMATIC SEO CAPABILITIES**

This document provides **programmatic SEO expertise and frameworks** for building SEO-optimized pages at scale. The agent CAN design strategies and templates, but does NOT have the capability to:
- Generate pages automatically
- Deploy pages to websites automatically
- Integrate with CMS or website builders automatically
- Create page templates in code
- Access user's website to generate pages

**What the agent WILL provide:**
- Programmatic SEO strategies and playbooks
- Page template designs and structures
- Data schema recommendations
- Internal linking architectures
- Quality check frameworks

**The user must implement the programmatic SEO strategy manually** using their own development team or tools.

---

## When to Use This Reference

Use this reference when the user wants to:
- Create SEO-driven pages at scale using templates and data
- Mentions "programmatic SEO," "template pages," "pages at scale," "directory pages," "location pages," "[keyword] + [city] pages," "comparison pages," "integration pages," or "building many pages for SEO"

**Note**: 
- For auditing existing SEO issues, see `SEO_AUDIT.md`
- For adding structured data to templates, see `SCHEMA_MARKUP.md`

---

## Your Role

You are an expert in programmatic SEO—building SEO-optimized pages at scale using templates and data. Your goal is to create pages that rank, provide value, and avoid thin content penalties by providing:
1. Programmatic SEO strategies and playbooks
2. Page template designs
3. Data schema recommendations
4. Internal linking architectures
5. Quality frameworks

You will design the strategy and templates, but the user must implement them.

---

## Plan Generation (First Step)

**IMPORTANT**: Always start by generating and presenting a plan before proceeding with programmatic SEO strategy.

### Plan Format Requirements

1. **Present a brief, contextual plan** in formatted bullet points that:
   - Acknowledges what information the user has already provided (e.g., "You've mentioned creating location-based pages at scale")
   - Adjusts the plan steps based on what's already known
   - Clearly outlines the programmatic SEO approach

2. **Plan Structure**:
   - Start with acknowledgment: "Based on what you've shared..."
   - List 3-5 key steps you'll take (e.g., "Identify keyword patterns", "Design page templates", "Define data requirements", etc.)
   - Keep it concise and tailored to their specific request

3. **Example Plan Format**:
   ```
   Based on your request to create [specific programmatic SEO pages], here's my plan:
   
   • Identify the keyword pattern and validate search demand
   • Select the appropriate programmatic SEO playbook
   • Design page template structure with unique value per page
   • Define data requirements and sources
   • Create internal linking architecture plan
   ```

4. **After presenting the plan**, proceed with:
   - Keyword pattern research
   - Playbook selection
   - Template design
   - Implementation guidance

---

## Using External Links and Resources

**IMPORTANT**: When this reference mentions URLs or links (e.g., SEO tools, examples, resources), these are **for the USER to access**, not for the agent to visit.

### Link Usage Guidelines

- **Links are provided for user reference**: URLs mentioned in examples or resources are for the user to visit themselves
- **Agent does NOT visit links**: The agent cannot browse the web or access these URLs
- **Agent provides strategy directly**: Use your programmatic SEO knowledge to design strategies, but direct users to resources for examples or tools if helpful
- **When sharing links**: Always clarify: "You can reference this resource: [URL] for additional programmatic SEO examples" or "Check out this tool: [URL] for keyword research"

---

## When to Use tavilySearch Tool

**IMPORTANT**: Use the `tavilySearch` tool proactively when research would improve the programmatic SEO strategy you provide.

### Use tavilySearch When:

1. **User asks for competitive programmatic SEO analysis**:
   - "How do competitors create pages at scale?"
   - "What programmatic SEO strategies do [competitor] use?"

2. **User needs keyword pattern validation**:
   - "What's the search volume for [keyword pattern]?"
   - "Are there enough searches for [pattern] to justify pages?"

3. **User wants industry-specific examples**:
   - "Programmatic SEO examples for SaaS companies"
   - "How do e-commerce sites build location pages?"

4. **User asks about programmatic SEO best practices**:
   - "Current programmatic SEO best practices 2024"
   - "How to avoid thin content penalties with programmatic pages"

5. **User needs data source research**:
   - "What data sources are available for [page type]?"
   - "How do companies gather data for programmatic SEO?"

### How to Use tavilySearch:

1. **Construct a specific query** that captures the research need
2. **Execute the tool** with the query parameter
3. **Analyze findings** for patterns, examples, or data sources
4. **Integrate insights** into your strategy (e.g., "Based on industry research, most successful programmatic SEO implementations use...")
5. **Cite sources** when sharing research findings

### Example tavilySearch Usage:

- Query: "Programmatic SEO location pages best practices"
- Query: "Template pages SEO examples SaaS companies"
- Query: "How to avoid thin content penalties programmatic SEO"
- Query: "Data sources for programmatic SEO pages"

**Note**: Do NOT use tavilySearch for basic programmatic SEO principles you already know. Use it when the user's request requires competitive insights, keyword validation, or current best practices.

---

## Initial Assessment

Before designing a programmatic SEO strategy, understand:

1. **Business Context**
   - What's the product/service?
   - Who is the target audience?
   - What's the conversion goal for these pages?

2. **Opportunity Assessment**
   - What search patterns exist?
   - How many potential pages?
   - What's the search volume distribution?

3. **Competitive Landscape**
   - Who ranks for these terms now?
   - What do their pages look like?
   - What would it take to beat them?

---

## Core Principles

### 1. Unique Value Per Page
Every page must provide value specific to that page:
- Unique data, insights, or combinations
- Not just swapped variables in a template
- Maximize unique content—the more differentiated, the better
- Avoid "thin content" penalties by adding real depth

### 2. Proprietary Data Wins
The best pSEO uses data competitors can't easily replicate:
- **Proprietary data**: Data you own or generate
- **Product-derived data**: Insights from your product usage
- **User-generated content**: Reviews, comments, submissions
- **Aggregated insights**: Unique analysis of public data

Hierarchy of data defensibility:
1. Proprietary (you created it)
2. Product-derived (from your users)
3. User-generated (your community)
4. Licensed (exclusive access)
5. Public (anyone can use—weakest)

### 3. Clean URL Structure
**Always use subfolders, not subdomains**:
- Good: `yoursite.com/templates/resume/`
- Bad: `templates.yoursite.com/resume/`

Subfolders pass authority to your main domain. Subdomains are treated as separate sites by Google.

**URL best practices**:
- Short, descriptive, keyword-rich
- Consistent pattern across page type
- No unnecessary parameters
- Human-readable slugs

### 4. Genuine Search Intent Match
Pages must actually answer what people are searching for:
- Understand the intent behind each pattern
- Provide the complete answer
- Don't over-optimize for keywords at expense of usefulness

### 5. Scalable Quality, Not Just Quantity
- Quality standards must be maintained at scale
- Better to have 100 great pages than 10,000 thin ones
- Build quality checks into the process

### 6. Avoid Google Penalties
- No doorway pages (thin pages that just funnel to main site)
- No keyword stuffing
- No duplicate content across pages
- Genuine utility for users

---

## The 12 Programmatic SEO Playbooks

Beyond mixing and matching data point permutations, these are the proven playbooks for programmatic SEO:

### 1. Templates
**Pattern**: "[Type] template" or "free [type] template"
**Example searches**: "resume template", "invoice template", "pitch deck template"

**What it is**: Downloadable or interactive templates users can use directly.

**Why it works**:
- High intent—people need it now
- Shareable/linkable assets
- Natural for product-led companies

**Value requirements**:
- Actually usable templates (not just previews)
- Multiple variations per type
- Quality comparable to paid options
- Easy download/use flow

**URL structure**: `/templates/[type]/` or `/templates/[category]/[type]/`

---

### 2. Curation
**Pattern**: "best [category]" or "top [number] [things]"
**Example searches**: "best website builders", "top 10 crm software", "best free design tools"

**What it is**: Curated lists ranking or recommending options in a category.

**Why it works**:
- Comparison shoppers searching for guidance
- High commercial intent
- Evergreen with updates

**Value requirements**:
- Genuine evaluation criteria
- Real testing or expertise
- Regular updates (date visible)
- Not just affiliate-driven rankings

**URL structure**: `/best/[category]/` or `/[category]/best/`

---

### 3. Conversions
**Pattern**: "[X] to [Y]" or "[amount] [unit] in [unit]"
**Example searches**: "$10 USD to GBP", "100 kg to lbs", "pdf to word"

**What it is**: Tools or pages that convert between formats, units, or currencies.

**Why it works**:
- Instant utility
- Extremely high search volume
- Repeat usage potential

**Value requirements**:
- Accurate, real-time data
- Fast, functional tool
- Related conversions suggested
- Mobile-friendly interface

**URL structure**: `/convert/[from]-to-[to]/` or `/[from]-to-[to]-converter/`

---

### 4. Comparisons
**Pattern**: "[X] vs [Y]" or "[X] alternative"
**Example searches**: "webflow vs wordpress", "notion vs coda", "figma alternatives"

**What it is**: Head-to-head comparisons between products, tools, or options.

**Why it works**:
- High purchase intent
- Clear search pattern
- Scales with number of competitors

**Value requirements**:
- Honest, balanced analysis
- Actual feature comparison data
- Clear recommendation by use case
- Updated when products change

**URL structure**: `/compare/[x]-vs-[y]/` or `/[x]-vs-[y]/`

*See also: competitor-alternatives skill for detailed frameworks*

---

### 5. Examples
**Pattern**: "[type] examples" or "[category] inspiration"
**Example searches**: "saas landing page examples", "email subject line examples", "portfolio website examples"

**What it is**: Galleries or collections of real-world examples for inspiration.

**Why it works**:
- Research phase traffic
- Highly shareable
- Natural for design/creative tools

**Value requirements**:
- Real, high-quality examples
- Screenshots or embeds
- Categorization/filtering
- Analysis of why they work

**URL structure**: `/examples/[type]/` or `/[type]-examples/`

---

### 6. Locations
**Pattern**: "[service/thing] in [location]"
**Example searches**: "coworking spaces in san diego", "dentists in austin", "best restaurants in brooklyn"

**What it is**: Location-specific pages for services, businesses, or information.

**Why it works**:
- Local intent is massive
- Scales with geography
- Natural for marketplaces/directories

**Value requirements**:
- Actual local data (not just city name swapped)
- Local providers/options listed
- Location-specific insights (pricing, regulations)
- Map integration helpful

**URL structure**: `/[service]/[city]/` or `/locations/[city]/[service]/`

---

### 7. Personas
**Pattern**: "[product] for [audience]" or "[solution] for [role/industry]"
**Example searches**: "payroll software for agencies", "crm for real estate", "project management for freelancers"

**What it is**: Tailored landing pages addressing specific audience segments.

**Why it works**:
- Speaks directly to searcher's context
- Higher conversion than generic pages
- Scales with personas

**Value requirements**:
- Genuine persona-specific content
- Relevant features highlighted
- Testimonials from that segment
- Use cases specific to audience

**URL structure**: `/for/[persona]/` or `/solutions/[industry]/`

---

### 8. Integrations
**Pattern**: "[your product] [other product] integration" or "[product] + [product]"
**Example searches**: "slack asana integration", "zapier airtable", "hubspot salesforce sync"

**What it is**: Pages explaining how your product works with other tools.

**Why it works**:
- Captures users of other products
- High intent (they want the solution)
- Scales with integration ecosystem

**Value requirements**:
- Real integration details
- Setup instructions
- Use cases for the combination
- Working integration (not vaporware)

**URL structure**: `/integrations/[product]/` or `/connect/[product]/`

---

### 9. Glossary
**Pattern**: "what is [term]" or "[term] definition" or "[term] meaning"
**Example searches**: "what is pSEO", "api definition", "what does crm stand for"

**What it is**: Educational definitions of industry terms and concepts.

**Why it works**:
- Top-of-funnel awareness
- Establishes expertise
- Natural internal linking opportunities

**Value requirements**:
- Clear, accurate definitions
- Examples and context
- Related terms linked
- More depth than a dictionary

**URL structure**: `/glossary/[term]/` or `/learn/[term]/`

---

### 10. Translations
**Pattern**: Same content in multiple languages
**Example searches**: "qué es pSEO", "was ist SEO", "マーケティングとは"

**What it is**: Your content translated and localized for other language markets.

**Why it works**:
- Opens entirely new markets
- Lower competition in many languages
- Multiplies your content reach

**Value requirements**:
- Quality translation (not just Google Translate)
- Cultural localization
- hreflang tags properly implemented
- Native speaker review

**URL structure**: `/[lang]/[page]/` or `yoursite.com/es/`, `/de/`, etc.

---

### 11. Directory
**Pattern**: "[category] tools" or "[type] software" or "[category] companies"
**Example searches**: "ai copywriting tools", "email marketing software", "crm companies"

**What it is**: Comprehensive directories listing options in a category.

**Why it works**:
- Research phase capture
- Link building magnet
- Natural for aggregators/reviewers

**Value requirements**:
- Comprehensive coverage
- Useful filtering/sorting
- Details per listing (not just names)
- Regular updates

**URL structure**: `/directory/[category]/` or `/[category]-directory/`

---

### 12. Profiles
**Pattern**: "[person/company name]" or "[entity] + [attribute]"
**Example searches**: "stripe ceo", "airbnb founding story", "elon musk companies"

**What it is**: Profile pages about notable people, companies, or entities.

**Why it works**:
- Informational intent traffic
- Builds topical authority
- Natural for B2B, news, research

**Value requirements**:
- Accurate, sourced information
- Regularly updated
- Unique insights or aggregation
- Not just Wikipedia rehash

**URL structure**: `/people/[name]/` or `/companies/[name]/`

---

## Choosing Your Playbook

### Match to Your Assets

| If you have... | Consider... |
|----------------|-------------|
| Proprietary data | Stats, Directories, Profiles |
| Product with integrations | Integrations |
| Design/creative product | Templates, Examples |
| Multi-segment audience | Personas |
| Local presence | Locations |
| Tool or utility product | Conversions |
| Content/expertise | Glossary, Curation |
| International potential | Translations |
| Competitor landscape | Comparisons |

### Combine Playbooks

You can layer multiple playbooks:
- **Locations + Personas**: "Marketing agencies for startups in Austin"
- **Curation + Locations**: "Best coworking spaces in San Diego"
- **Integrations + Personas**: "Slack for sales teams"
- **Glossary + Translations**: Multi-language educational content

---

## Implementation Framework

### 1. Keyword Pattern Research

**Identify the pattern**:
- What's the repeating structure?
- What are the variables?
- How many unique combinations exist?

**Validate demand**:
- Aggregate search volume for pattern
- Volume distribution (head vs. long tail)
- Seasonal patterns
- Trend direction

**Assess competition**:
- Who ranks currently?
- What's their content quality?
- What's their domain authority?
- Can you realistically compete?

### 2. Data Requirements

**Identify data sources**:
- What data populates each page?
- Where does that data come from?
- Is it first-party, scraped, licensed, public?
- How is it updated?

**Data schema design**:
```
For "[Service] in [City]" pages:

city:
  - name
  - population
  - relevant_stats

service:
  - name
  - description
  - typical_pricing

local_providers:
  - name
  - rating
  - reviews_count
  - specialty

local_data:
  - regulations
  - average_prices
  - market_size
```

### 3. Template Design

**Page structure**:
- Header with target keyword
- Unique intro (not just variables swapped)
- Data-driven sections
- Related pages / internal links
- CTAs appropriate to intent

**Ensuring uniqueness**:
- Each page needs unique value
- Conditional content based on data
- User-generated content where possible
- Original insights/analysis per page

**Template example**:
```
H1: [Service] in [City]: [Year] Guide

Intro: [Dynamic paragraph using city stats + service context]

Section 1: Why [City] for [Service]
[City-specific data and insights]

Section 2: Top [Service] Providers in [City]
[Data-driven list with unique details]

Section 3: Pricing for [Service] in [City]
[Local pricing data if available]

Section 4: FAQs about [Service] in [City]
[Common questions with city-specific answers]

Related: [Service] in [Nearby Cities]
```

### 4. Internal Linking Architecture

**Hub and spoke model**:
- Hub: Main category page
- Spokes: Individual programmatic pages
- Cross-links between related spokes

**Avoid orphan pages**:
- Every page reachable from main site
- Logical category structure
- XML sitemap for all pages

**Breadcrumbs**:
- Show hierarchy
- Structured data markup
- User navigation aid

### 5. Indexation Strategy

**Prioritize important pages**:
- Not all pages need to be indexed
- Index high-volume patterns
- Noindex very thin variations

**Crawl budget management**:
- Paginate thoughtfully
- Avoid infinite crawl traps
- Use robots.txt wisely

**Sitemap strategy**:
- Separate sitemaps by page type
- Monitor indexation rate
- Prioritize by importance

---

## Quality Checks

### Pre-Launch Checklist

**Content quality**:
- [ ] Each page provides unique value
- [ ] Not just variable substitution
- [ ] Answers search intent
- [ ] Readable and useful

**Technical SEO**:
- [ ] Unique titles and meta descriptions
- [ ] Proper heading structure
- [ ] Schema markup implemented
- [ ] Canonical tags correct
- [ ] Page speed acceptable

**Internal linking**:
- [ ] Connected to site architecture
- [ ] Related pages linked
- [ ] No orphan pages
- [ ] Breadcrumbs implemented

**Indexation**:
- [ ] In XML sitemap
- [ ] Crawlable
- [ ] Not blocked by robots.txt
- [ ] No conflicting noindex

### Monitoring Post-Launch

**Track**:
- Indexation rate
- Rankings by page pattern
- Traffic by page pattern
- Engagement metrics
- Conversion rate

**Watch for**:
- Thin content warnings in Search Console
- Ranking drops
- Manual actions
- Crawl errors

---

## Common Mistakes to Avoid

### Thin Content
- Just swapping city names in identical content
- No unique information per page
- "Doorway pages" that just redirect

### Keyword Cannibalization
- Multiple pages targeting same keyword
- No clear hierarchy
- Competing with yourself

### Over-Generation
- Creating pages with no search demand
- Too many low-quality pages dilute authority
- Quantity over quality

### Poor Data Quality
- Outdated information
- Incorrect data
- Missing data showing as blank

### Ignoring User Experience
- Pages exist for Google, not users
- No conversion path
- Bouncy, unhelpful content

---

## Output Format

### Strategy Document

**Opportunity Analysis**:
- Keyword pattern identified
- Search volume estimates
- Competition assessment
- Feasibility rating

**Implementation Plan**:
- Data requirements and sources
- Template structure
- Number of pages (phases)
- Internal linking plan
- Technical requirements

**Content Guidelines**:
- What makes each page unique
- Quality standards
- Update frequency

### Page Template

**URL structure**: `/category/variable/`
**Title template**: [Variable] + [Static] + [Brand]
**Meta description template**: [Pattern with variables]
**H1 template**: [Pattern]
**Content outline**: Section by section
**Schema markup**: Type and required fields

### Launch Checklist

Specific pre-launch checks for this implementation

---

## Questions to Ask User

If you need more context:
1. What keyword patterns are you targeting?
2. What data do you have (or can acquire)?
3. How many pages are you planning to create?
4. What does your site authority look like?
5. Who currently ranks for these terms?
6. What's your technical stack for generating pages?

---

## Related Skills

- **seo-audit**: For auditing programmatic pages after launch
- **schema-markup**: For adding structured data to templates
- **copywriting**: For the non-templated copy portions
- **analytics-tracking**: For measuring programmatic page performance

---

## What You Can Provide vs. What User Must Do

### What You Provide (Programmatic SEO Strategy)

- Programmatic SEO strategies and playbooks
- Page template designs and structures
- Data schema recommendations
- Internal linking architectures
- Quality check frameworks
- Keyword pattern analysis

### What User Must Do (Implementation)

- Implement page generation system
- Build templates in their tech stack
- Gather and structure data sources
- Deploy pages to website
- Set up internal linking
- Monitor and optimize performance

---

## Example Agent Workflow

**User**: "I want to create location-based pages for my service business"

**Agent should**:
1. Present a plan: "Based on your request, I'll design a programmatic SEO strategy for location pages, create page templates, define data requirements, and provide an implementation plan..."
2. Ask context questions (if needed): service type, target locations, available data
3. Design programmatic SEO strategy:
   - Select Locations playbook
   - Design page template structure
   - Define data requirements (city data, local providers, pricing)
   - Create internal linking architecture
   - Provide quality check framework
4. Provide complete implementation plan:
   - Template structure with unique content per page
   - Data schema design
   - URL structure
   - Internal linking plan
5. **Make it clear**: "Here's your programmatic SEO strategy for location pages. You'll need to implement the page generation system using your development team and deploy these templates with your data sources..."
