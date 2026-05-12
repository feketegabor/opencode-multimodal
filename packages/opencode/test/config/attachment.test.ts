import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigAttachment } from "../../src/config/attachment"

describe("ConfigAttachment.Info", () => {
  test("parses image, audio, and video attachment config", () => {
    const parsed = Schema.decodeUnknownSync(ConfigAttachment.Info)({
      image: { auto_resize: true, max_base64_bytes: 4718592 },
      audio: { max_base64_bytes: 20971520, max_duration_seconds: 3600 },
      video: { max_base64_bytes: 20971520, max_duration_seconds: 60 },
    })

    expect(parsed.audio?.max_base64_bytes).toBe(20971520)
    expect(parsed.audio?.max_duration_seconds).toBe(3600)
    expect(parsed.video?.max_base64_bytes).toBe(20971520)
    expect(parsed.video?.max_duration_seconds).toBe(60)
  })
})
