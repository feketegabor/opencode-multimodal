import { describe, expect, test } from "bun:test"
import {
  isAudioAttachment,
  isImageAttachment,
  isMedia,
  isPdfAttachment,
  isVideoAttachment,
  sniffAttachmentMime,
} from "../../src/util/media"

describe("util.media", () => {
  test("classifies image, pdf, audio, and video as media", () => {
    expect(isImageAttachment("image/png")).toBe(true)
    expect(isPdfAttachment("application/pdf")).toBe(true)
    expect(isAudioAttachment("audio/mpeg")).toBe(true)
    expect(isVideoAttachment("video/mp4")).toBe(true)
    expect(isMedia("image/png")).toBe(true)
    expect(isMedia("application/pdf")).toBe(true)
    expect(isMedia("audio/wav")).toBe(true)
    expect(isMedia("video/webm")).toBe(true)
    expect(isMedia("text/plain")).toBe(false)
  })

  test("sniffs common audio and video signatures", () => {
    expect(sniffAttachmentMime(Uint8Array.from([0x49, 0x44, 0x33, 0, 0]), "application/octet-stream")).toBe(
      "audio/mpeg",
    )
    expect(sniffAttachmentMime(Uint8Array.from([0xff, 0xfa, 0x90, 0x64]), "application/octet-stream")).toBe(
      "audio/mpeg",
    )
    expect(sniffAttachmentMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), "")).toBe(
      "audio/wav",
    )
    expect(sniffAttachmentMime(Uint8Array.from([0x4f, 0x67, 0x67, 0x53]), "")).toBe("audio/ogg")
    expect(sniffAttachmentMime(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), "")).toBe("video/mp4")
    expect(sniffAttachmentMime(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), "audio/mp4")).toBe(
      "audio/mp4",
    )
    expect(sniffAttachmentMime(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), "audio/mpeg")).toBe(
      "audio/mp4",
    )
    expect(sniffAttachmentMime(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), "")).toBe("video/webm")
    expect(sniffAttachmentMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]), "")).toBe(
      "video/x-msvideo",
    )
  })
})
