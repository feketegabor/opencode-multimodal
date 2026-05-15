import { PartID } from "@/session/schema"
import { isAmbiguousMediaFallback, isAudioAttachment, isMedia, isPdfAttachment, isVideoAttachment } from "@/util/media"
import type { PromptInfo } from "./history"

type Item = PromptInfo["parts"][number]

export function strip(part: Item & { id: string; messageID: string; sessionID: string }): Item {
  const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = part
  return rest
}

export function assign(part: Item): Item & { id: PartID } {
  return {
    ...part,
    id: PartID.ascending(),
  }
}

export function isPromptMediaAttachment(mime: string) {
  return isMedia(mime) && !isAmbiguousMediaFallback(mime)
}

export function promptFilePartLabel(mime: string) {
  if (!isPromptMediaAttachment(mime)) return undefined
  if (isPdfAttachment(mime)) return "PDF"
  if (isAudioAttachment(mime)) return "Audio"
  if (isVideoAttachment(mime)) return "Video"
  return "Image"
}
