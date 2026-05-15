import { describe, expect, test } from "bun:test"
import { redactLiveExperimentOutput } from "../../script/multimodal-live"

describe("multimodal live experiment redaction", () => {
  test("redacts credentials, upload URIs, and media payloads", () => {
    const output = redactLiveExperimentOutput({
      headers: { Authorization: "Bearer secret", "x-goog-api-key": "key" },
      body: {
        fileUri: "gs://bucket/video.mp4",
        inlineData: { mimeType: "video/mp4", data: "AAAA" },
        parts: [{ type: "audio", url: "file:///C:/Users/feket/secret.wav" }],
      },
    })

    expect(JSON.stringify(output)).not.toContain("Bearer secret")
    expect(JSON.stringify(output)).not.toContain('"x-goog-api-key":"key"')
    expect(JSON.stringify(output)).not.toContain("AAAA")
    expect(JSON.stringify(output)).not.toContain("gs://")
    expect(JSON.stringify(output)).not.toContain("file:///")
    expect(JSON.stringify(output)).toContain("[REDACTED]")
  })
})
