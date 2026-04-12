// ---------------------------------------------------------------------------
// Artifact delta streaming parser
//
// Pure-function logic for extracting a target field's content from incrementally
// arriving JSON tool-call args.  No dependency on stream controllers or persistence.
// ---------------------------------------------------------------------------

/**
 * Tracks the parse state for a single streaming artifact's JSON args.
 */
export interface ArtifactStreamState {
  toolCallId: string;
  toolName: string;
  artifactId: string;
  targetField: string;
  accumulated: string;       // raw JSON text accumulated so far
  fieldStartIndex: number;   // char index where the target field's value starts (-1 = not found yet)
  scannedRawOffset: number;  // how many raw JSON chars past fieldStartIndex we've already scanned
  inString: boolean;         // currently inside the target string value
  escaped: boolean;          // previous char was a backslash (for JSON escape handling)
}

/**
 * Find the start position of `fieldName`'s string value at the top level of a
 * JSON object being streamed.  Uses a simple depth / in-string tracker to avoid
 * matching the key inside a nested string value.
 *
 * @returns The char index of the first content character inside the value's
 *          opening quote, or -1 if the field hasn't appeared yet.
 */
export function findTopLevelFieldStart(
  json: string,
  fieldName: string,
): number {
  const keyPattern = `"${fieldName}"`;
  let inStr = false;
  let esc = false;
  let depth = 0;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }

    if (inStr) {
      if (ch === '"') inStr = false;
      continue;
    }

    // Outside any string
    if (ch === '"') {
      // Check if this starts our target key at depth 1 (top-level object)
      if (depth === 1 && json.startsWith(keyPattern, i)) {
        // Verify colon follows the key
        let j = i + keyPattern.length;
        while (j < json.length && /\s/.test(json[j])) j++;
        if (j < json.length && json[j] === ":") {
          // Skip whitespace after colon, find opening quote of value
          j++;
          while (j < json.length && /\s/.test(json[j])) j++;
          if (j < json.length && json[j] === '"') {
            return j + 1; // index of first content char
          }
        }
      }
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
    }
  }
  return -1;
}

/**
 * Extract new content from the accumulated JSON args of a streaming tool call.
 *
 * Call this after appending each `argsTextDelta` to `state.accumulated`.
 * The function advances the parse cursor, handling JSON string escapes
 * (including partial `\uXXXX` sequences split across deltas), and returns
 * the decoded content characters — or `null` when no new content is available.
 *
 * **Mutates** `state` (fieldStartIndex, scannedRawOffset, inString, escaped).
 */
export function processArtifactDelta(
  state: ArtifactStreamState,
  argsTextDelta: string,
): string | null {
  state.accumulated += argsTextDelta;

  // Look for the target field key if we haven't found it yet
  if (state.fieldStartIndex === -1) {
    const idx = findTopLevelFieldStart(state.accumulated, state.targetField);
    if (idx === -1) return null;
    state.fieldStartIndex = idx;
    state.inString = true;
    state.escaped = false;
  }

  if (!state.inString) return null;

  // Extract content chars from where we last stopped, handling JSON escaping.
  // Track the actual loop position so partial escapes (e.g., \uXXXX split across
  // deltas) correctly rewind instead of skipping unprocessed characters.
  const HEX4 = /^[0-9a-fA-F]{4}$/;
  let contentChars = "";
  const start = state.fieldStartIndex + state.scannedRawOffset;
  let lastSafeOffset = start; // tracks the position AFTER the last fully processed char

  for (let i = start; i < state.accumulated.length; i++) {
    const ch = state.accumulated[i];

    if (state.escaped) {
      if (ch === "u") {
        // Unicode escape \uXXXX: need 4 hex chars after 'u'
        const hex = state.accumulated.slice(i + 1, i + 5);
        if (hex.length === 4 && HEX4.test(hex)) {
          contentChars += String.fromCharCode(parseInt(hex, 16));
          i += 4; // skip the 4 hex digits
          lastSafeOffset = i + 1;
        } else if (state.accumulated.length < i + 5) {
          // Partial unicode — rewind to the backslash position and wait for more data.
          // The backslash is at i-1 (it set escaped=true on the previous iteration).
          // Leave escaped=false so the backslash is re-read on the next call.
          state.escaped = false;
          // lastSafeOffset stays where it was — we do NOT advance past the backslash
          break;
        } else {
          // Invalid hex — emit literally
          contentChars += "u" + hex;
          i += 4;
          lastSafeOffset = i + 1;
        }
      } else {
        switch (ch) {
          case '"': contentChars += '"'; break;
          case '\\': contentChars += '\\'; break;
          case 'n': contentChars += '\n'; break;
          case 'r': contentChars += '\r'; break;
          case 't': contentChars += '\t'; break;
          case 'b': contentChars += '\b'; break;
          case 'f': contentChars += '\f'; break;
          case '/': contentChars += '/'; break;
          default: contentChars += ch; break;
        }
        lastSafeOffset = i + 1;
      }
      state.escaped = false;
      continue;
    }

    if (ch === '\\') {
      state.escaped = true;
      continue;
    }

    if (ch === '"') {
      state.inString = false;
      lastSafeOffset = i + 1;
      break;
    }

    contentChars += ch;
    lastSafeOffset = i + 1;
  }

  // If the loop ended with a pending escape (backslash was the last char in buffer),
  // reset it so the backslash is re-read as an escape initiator on the next call.
  // lastSafeOffset already stays before the backslash, so it will be re-processed.
  if (state.escaped) {
    state.escaped = false;
  }

  // Update scan offset to the last safely processed position (NOT end of buffer).
  // This ensures partial escape sequences at chunk boundaries are re-processed.
  state.scannedRawOffset = lastSafeOffset - state.fieldStartIndex;

  return contentChars.length > 0 ? contentChars : null;
}
