import type { ArtifactEventData } from "./artifacts";

// NOTE: Legacy events with type "markdown-doc" exist in stored messages in the DB.
// They are handled at runtime via KNOWN_EVENT_TYPES (string set) in stream-processor.ts,
// but are NOT included in this union type. New code should use the "artifact" event
// with kind: "markdown" instead.

export type StreamEvent =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "image"; id: string; data: Record<string, unknown> }
  | { type: "video"; id: string; data: Record<string, unknown> }
  | { type: "agent-start"; data: Record<string, unknown> }
  | { type: "agent-utility"; id: string; data: Record<string, unknown> }
  | { type: "agent-task"; id: string; data: Record<string, unknown> }
  | { type: "suggestions"; id: string; data: { suggestions: string[] } }
  | { type: "user-action"; id: string; data: Record<string, unknown> }
  | { type: "markdown"; id: string; data: Record<string, unknown> }
  | { type: "html"; id: string; data: Record<string, unknown> }
  | { type: "artifact"; id: string; data: ArtifactEventData }
  | { type: "artifact-delta"; id: string; data: { id: string; delta: string } }
  | { type: "finish"; source: string }
  | { type: "error"; id: string; data: Record<string, unknown> }
  | { type: "heartbeat" };
