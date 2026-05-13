import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { extractPromptFromParts } from "./prompt"
import { normalizePromptStore } from "./prompt-parts"

describe("extractPromptFromParts", () => {
  test("restores multiple uploaded attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check these",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAA",
        filename: "a.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_2",
        type: "file",
        mime: "application/pdf",
        url: "data:application/pdf;base64,BBB",
        filename: "b.pdf",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "check these" })
    expect(result.slice(1)).toMatchObject([
      { type: "media", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      { type: "media", filename: "b.pdf", mime: "application/pdf", dataUrl: "data:application/pdf;base64,BBB" },
    ])
  })

  test("restores uploaded media with source metadata as media attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "describe",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "video/mp4",
        url: "file:///C:/Users/feket/.local/share/opencode/uploads/clip.mp4",
        filename: "clip.mp4",
        source: {
          type: "file",
          path: "C:/Users/feket/.local/share/opencode/uploads/clip.mp4",
          text: { value: "clip.mp4", start: 0, end: 8 },
        },
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    expect(extractPromptFromParts(parts)).toMatchObject([
      { type: "text", content: "describe" },
      {
        type: "media",
        id: "file_1",
        filename: "clip.mp4",
        mime: "video/mp4",
        url: "file:///C:/Users/feket/.local/share/opencode/uploads/clip.mp4",
        source: {
          type: "file",
          path: "C:/Users/feket/.local/share/opencode/uploads/clip.mp4",
          text: { value: "clip.mp4", start: 0, end: 8 },
        },
      },
    ])
  })
})

describe("prompt part normalization", () => {
  test("normalizes legacy image draft attachments to media parts", () => {
    expect(
      normalizePromptStore({
        prompt: [
          { type: "text", content: "look", start: 0, end: 4 },
          {
            type: "image",
            id: "legacy_image",
            filename: "draft.png",
            mime: "image/png",
            dataUrl: "data:image/png;base64,AAA",
          },
        ],
        cursor: 4,
        context: { items: [] },
      }),
    ).toEqual({
      prompt: [
        { type: "text", content: "look", start: 0, end: 4 },
        {
          type: "media",
          id: "legacy_image",
          filename: "draft.png",
          mime: "image/png",
          dataUrl: "data:image/png;base64,AAA",
        },
      ],
      cursor: 4,
      context: { items: [] },
    })
  })
})
