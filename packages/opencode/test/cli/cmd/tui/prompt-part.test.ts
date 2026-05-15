import { describe, expect, test } from "bun:test"
import type { PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"
import {
  assign,
  isPromptMediaAttachment,
  promptFilePartLabel,
  strip,
} from "../../../../src/cli/cmd/tui/component/prompt/part"

describe("prompt part", () => {
  test("strip removes persisted ids from reused file parts", () => {
    const part = {
      id: "prt_old",
      sessionID: "ses_old",
      messageID: "msg_old",
      type: "file" as const,
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    }

    expect(strip(part)).toEqual({
      type: "file",
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    })
  })

  test("assign overwrites stale runtime ids", () => {
    const part = {
      id: "prt_old",
      sessionID: "ses_old",
      messageID: "msg_old",
      type: "file" as const,
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    } as PromptInfo["parts"][number]

    const next = assign(part)

    expect(next.id).not.toBe("prt_old")
    expect(next.id.startsWith("prt_")).toBe(true)
    expect(next).toMatchObject({
      type: "file",
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    })
  })

  test("accepts every core prompt media attachment type", () => {
    expect(["image/png", "application/pdf", "audio/mpeg", "video/webm"].filter(isPromptMediaAttachment)).toEqual([
      "image/png",
      "application/pdf",
      "audio/mpeg",
      "video/webm",
    ])
    expect(isPromptMediaAttachment("video/mp2t")).toBe(false)
  })

  test("labels prompt file parts by media category", () => {
    expect(promptFilePartLabel("image/png")).toBe("Image")
    expect(promptFilePartLabel("application/pdf")).toBe("PDF")
    expect(promptFilePartLabel("audio/mpeg")).toBe("Audio")
    expect(promptFilePartLabel("video/webm")).toBe("Video")
    expect(promptFilePartLabel("text/plain")).toBeUndefined()
  })
})
