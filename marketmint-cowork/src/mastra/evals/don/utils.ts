/**
 * Extracts plain text from AI SDK message structures.
 *
 * Handles all shapes that `run.input` / `run.output` can take in agent scorers:
 *  - plain string
 *  - CoreMessage[] (content may be a string or multi-part array)
 *  - single object with `.content` or `.text`
 *  - unknown fallback via JSON.stringify / String()
 */
export function extractMessagesText(data: unknown): string {
  if (typeof data === "string") return data;

  if (Array.isArray(data)) {
    return data
      .map((m: any) => {
        const content = m?.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n");
        }
        return typeof content === "undefined"
          ? JSON.stringify(m)
          : JSON.stringify(content);
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.text === "string") return obj.text;
    return JSON.stringify(data);
  }

  return String(data);
}
