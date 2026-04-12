import { Attachment, MessagePart } from "@/db/schema";
import { z, ZodType } from "zod";

export const MessageBodySchema: ZodType<MessagePart> = z.object({
  type: z.string(),
  text: z.string().optional(),
})

export const AttachmentBodySchema: ZodType<Attachment> = z.object({
  url: z.string()
})

export const ChatBodySchema = z
  .object({
    chat_id: z.string(),
    content: z.array(MessageBodySchema),
    attachments: z.array(AttachmentBodySchema).optional(),
    direct_gen_bm: z.boolean().optional(),
  });
