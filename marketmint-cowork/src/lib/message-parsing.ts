import { Attachment, MessagePart } from "@/db/schema";
import { buildAttachmentCatalog, buildUserText } from "./attachment-formatting";

/** Extract text content parts from the last user message in a messages array. */
export function deriveContentFromMessages(messages: any[]): any[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (Array.isArray(m.parts)) {
      const parts = m.parts
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => ({ type: "text", text: p.text }));
      if (parts.length) return parts;
    }
    if (typeof m.content === "string" && m.content.trim()) {
      return [{ type: "text", text: m.content }];
    }
  }
  return [];
}

export const createUserMessage = ({
  content,
  enrichedAttachments,
}: {
  content: MessagePart[];
  enrichedAttachments: Attachment[];
}) => {
  const userText = buildUserText(content, enrichedAttachments);
  const attachmentsText = buildAttachmentCatalog(enrichedAttachments);

  return `${userText}\nATTACHED ASSETS:${attachmentsText}`
}
