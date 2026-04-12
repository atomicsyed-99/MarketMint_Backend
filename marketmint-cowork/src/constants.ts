/**
 * Orchestrator supervisor: max tool/model steps per chat request (`handleChatStream` → `maxSteps`).
 * Keep in sync with `marketMintAgent` `defaultOptions` (`onIterationComplete`, `onDelegationStart`).
 */
export const SUPERVISOR_MAX_STEPS = 20;

/** Steps allowed for a sub-agent when the supervisor delegates (Mastra `modifiedMaxSteps`). */
export const DELEGATION_SUB_AGENT_MAX_STEPS = 15;

/** Scheduled job runs that exceed this total token count trigger a Slack alert (same channel as job notifications). */
export const AGENT_JOB_TOKEN_SLACK_ALERT_THRESHOLD = 80_000;
