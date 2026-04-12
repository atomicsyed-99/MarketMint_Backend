import { MessagePart } from "@/db/schema";

type AttachmentRecord = Record<string, unknown>;

/** Filter attachments to only those with a valid URL string. */
function withValidUrl(attachments: AttachmentRecord[]): AttachmentRecord[] {
  return attachments.filter(
    (a) => a && typeof a.url === "string" && (a.url as string).length > 0,
  );
}

/** Build the user text from content text parts and attachment metadata. */
export function buildUserText(
  content: MessagePart[],
  attachments: AttachmentRecord[],
): string {
  const textParts = content
    .filter((p) => p.type === "text")
    .map((p) => p.text);

  if (attachments.length === 0) return textParts.join("\n");

  const valid = withValidUrl(attachments);
  const urlLines = valid.map((a) => `URL: ${a.url}`);
  const metaLines = valid.map((a) => {
    const tag = (a.tag as string) ?? "";
    const desc = (a.description as string) ?? "";
    return `[Attachment: url=${a.url}, tag=${tag}, description=${desc}]`;
  });

  return [...textParts, ...urlLines, ...metaLines].join("\n");
}

/** Build a formatted catalog string for the system prompt. */
export function buildAttachmentCatalog(attachments: AttachmentRecord[]): string {
  if (attachments.length === 0) return "";

  const valid = withValidUrl(attachments);
  if (valid.length === 0) return "";

  return valid
    .map((a, idx) => {
      const t = (a.type as string) || "unknown";
      const tag = (a.tag as string) ?? "";
      const desc = (a.description as string) ?? "";
      return `- Attachment ${idx + 1}: type=${t}, tag=${tag}, description=${desc}, url=${a.url}`;
    })
    .join("\n");
}
