// ---------------------------------------------------------------------------
// Per-connector capability text (injected into system prompt when connected)
// ---------------------------------------------------------------------------

export const SHOPIFY_CAPABILITIES = `### Shopify (Admin API — Full Access)
Products: list, get, create, update, delete, list variants, list images
Orders: list, get, create fulfillments, create refunds
Customers: list, search, get, create, update
Inventory: list locations, get levels, adjust, set quantities
Collections: list, create custom/smart collections
Discounts: list/create price rules & discount codes
Draft Orders: list, get, create, complete
Gift Cards: list, create
Pages: list, create, update
Themes: list
Metafields: get for products
NOTE: Use shopify_* connector tools for authenticated Admin API access. The existing searchShopifyCatalog tool is for unauthenticated public catalog browsing only.`;

export const META_ADS_CAPABILITIES = `### Meta Ads (Facebook & Instagram)
Accounts: list ad accounts
Campaigns: list, create, update (pause/enable/budget)
Ad Sets: list, create, update
Ads: list individual ads within ad sets
Insights: account-level, campaign-level, ad-level performance (impressions, clicks, spend, CTR, CPC, ROAS)
Breakdowns: by age, gender, platform, device, placement, country
Creatives: list ad creatives with thumbnails`;

export const GOOGLE_ADS_CAPABILITIES = `### Google Ads
Accounts: list accessible customer accounts
Campaigns: list, update (pause/enable)
Ad Groups: list ad groups within campaigns
Keywords: list keywords within ad groups
Search Terms: get search terms report
Performance: daily performance metrics by date range
Conversions: list conversion actions
Budgets: update campaign budgets
Custom Queries: run arbitrary GAQL queries`;

export const GOOGLE_ANALYTICS_CAPABILITIES = `### Google Analytics (GA4)
Properties: list all accessible GA4 properties
Reports: run custom reports with any metrics/dimensions/date ranges
Realtime: get active users, live events, current page views
Top Pages: get top pages by pageviews for a date range
Traffic Sources: channel/source/medium breakdown with sessions, bounce rate
Demographics: country, city, device, browser, OS breakdowns`;

export const GOOGLE_SHEETS_CAPABILITIES = `### Google Sheets
Spreadsheets: create, get details
Sheets: list sheets in a spreadsheet, create new sheets, delete sheets
Data: read ranges, write ranges, append rows, clear ranges`;

export const KLAVIYO_CAPABILITIES = `### Klaviyo (Email & SMS Marketing)
Campaigns: list, get details, create, get performance reports
Flows: list automation flows, get flow details, get flow value reports
Lists: list all, get profiles in list, create list, add/remove profiles
Segments: list segments
Profiles: search by email, get profile, update profile, unsubscribe
Metrics: list available metrics, query metric aggregates`;

export const SLACK_CAPABILITIES = `### Slack
Channels: list public and private channels the bot has access to
Messages: send messages to channels`;

export const POSTHOG_CAPABILITIES = `### PostHog (Product Analytics)
Trends: event counts, unique users, aggregations over time with breakdowns
Events: list recent events with filtering by event name or person
Persons: search users by email, name, or distinct ID
Session Recordings: list recent session recordings
Feature Flags: list, create, update, toggle flags with rollout percentages
Dashboards: list all dashboards
Insights: list saved insights (charts, tables, funnels)
Funnels: run funnel analysis with conversion windows
Annotations: create annotations to mark deployments, sales, launches
Cohorts: list all cohorts
Event Definitions: list what events are being tracked`;
