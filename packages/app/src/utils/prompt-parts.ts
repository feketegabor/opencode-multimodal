import type { ContentPart, MediaAttachmentPart, Prompt } from "@/context/prompt"

type LegacyImageAttachmentPart = Omit<MediaAttachmentPart, "type"> & { type: "image" }
type StoredContentPart = ContentPart | LegacyImageAttachmentPart

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "media") return { ...part }
  if (part.type === "agent") return { ...part }
  return {
    ...part,
    selection: part.selection ? { ...part.selection } : undefined,
  }
}

export function normalizePromptParts(prompt: StoredContentPart[]): Prompt {
  return prompt.map((part) => {
    if (part.type === "image") return { ...part, type: "media" }
    return clonePart(part)
  })
}

export function normalizePromptStore(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const store = value as { prompt?: unknown }
  if (!Array.isArray(store.prompt)) return value
  return { ...value, prompt: normalizePromptParts(store.prompt as StoredContentPart[]) }
}
