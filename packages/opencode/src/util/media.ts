const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
const isMpegAudioFrame = (bytes: Uint8Array) =>
  bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0
const AMBIGUOUS_MEDIA_FALLBACKS = new Set(["video/mp2t"])

export function isPdfAttachment(mime: string) {
  return mime === "application/pdf"
}

export function isAudioAttachment(mime: string) {
  return mime.startsWith("audio/")
}

export function isVideoAttachment(mime: string) {
  return mime.startsWith("video/")
}

export function isMedia(mime: string) {
  return mime.startsWith("image/") || isPdfAttachment(mime) || isAudioAttachment(mime) || isVideoAttachment(mime)
}

export function isAmbiguousMediaFallback(mime: string) {
  return AMBIGUOUS_MEDIA_FALLBACKS.has(mime)
}

export function isImageAttachment(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
}

export function sniffAttachmentMime(bytes: Uint8Array, fallback: string) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg"
  if (isMpegAudioFrame(bytes)) return "audio/mpeg"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x41, 0x56, 0x45])) {
    return "audio/wav"
  }
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg"
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"
  if (startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) return fallback.startsWith("audio/") ? "audio/mp4" : "video/mp4"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x41, 0x56, 0x49, 0x20])) {
    return "video/x-msvideo"
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp"
  }

  return fallback
}

export function sniffAttachmentMimeSafe(bytes: Uint8Array, fallback: string) {
  const mime = sniffAttachmentMime(bytes, fallback)
  if (mime === fallback && isAmbiguousMediaFallback(fallback)) return "text/plain"
  return mime
}
