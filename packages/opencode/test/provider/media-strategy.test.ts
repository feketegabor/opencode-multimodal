import { describe, expect, test } from "bun:test"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ProviderMediaStrategy } from "../../src/provider/media-strategy"

function model(override: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: ModelID.make("mimo-v2.5"),
    providerID: ProviderID.make("opencode-go"),
    api: {
      id: "mimo-v2.5",
      url: "https://opencode.ai/zen/go/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Mimo v2.5",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, image: true, audio: true, video: true, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: 0,
      input: 0,
      output: 0,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    ...override,
  }
}

describe("ProviderMediaStrategy.resolve", () => {
  test("allows metadata-backed inline audio and video for opencode-go openai-compatible models", () => {
    const strategy = ProviderMediaStrategy.resolve(model())

    expect(strategy.accepted.has("audio")).toBe(true)
    expect(strategy.accepted.has("video")).toBe(true)
    expect(strategy.videoAudio).toBe("preserved")
    expect(strategy.transport({ mime: "audio/mpeg", url: "data:audio/mpeg;base64,Zm9v" })).toStrictEqual({
      type: "inline",
    })
    expect(strategy.transport({ mime: "video/mp4", url: "data:video/mp4;base64,Zm9v" })).toStrictEqual({
      type: "inline",
    })
  })

  test("marks video-only models as visual-only", () => {
    expect(
      ProviderMediaStrategy.resolve(
        model({
          providerID: ProviderID.make("moonshotai"),
          api: {
            id: "kimi-k2",
            url: "https://api.moonshot.ai",
            npm: "@ai-sdk/openai-compatible",
          },
          capabilities: {
            ...model().capabilities,
            input: { text: true, image: true, audio: false, video: true, pdf: false },
          },
        }),
      ).videoAudio,
    ).toBe("visual-only")
  })

  test("marks non-video models as unknown video audio handling", () => {
    expect(
      ProviderMediaStrategy.resolve(
        model({
          capabilities: {
            ...model().capabilities,
            input: { text: true, image: true, audio: true, video: false, pdf: false },
          },
        }),
      ).videoAudio,
    ).toBe("unknown")
  })

  test("rejects audio when model metadata lacks audio input support", () => {
    const result = ProviderMediaStrategy.resolve(
      model({
        capabilities: {
          ...model().capabilities,
          input: { text: true, image: true, audio: false, video: true, pdf: false },
        },
      }),
    ).transport({ mime: "audio/wav", url: "data:audio/wav;base64,Zm9v" })

    expect(result.type).toBe("reject")
    if (result.type === "reject") expect(result.reason).toContain("audio")
  })

  test("detects YouTube before generic HTTPS for Google models", () => {
    expect(
      ProviderMediaStrategy.resolve(
        model({
          providerID: ProviderID.make("google"),
          api: {
            id: "gemini-3-pro",
            url: "https://generativelanguage.googleapis.com",
            npm: "@ai-sdk/google",
          },
        }),
      ).transport({ mime: "video/mp4", url: "https://www.youtube.com/watch?v=abc123" }),
    ).toStrictEqual({ type: "url" })
  })

  test("rejects Google URL schemes that AI SDK cannot serialize directly", () => {
    const google = ProviderMediaStrategy.resolve(
      model({
        providerID: ProviderID.make("google"),
        api: {
          id: "gemini-3-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
        capabilities: {
          ...model().capabilities,
          input: { ...model().capabilities.input, pdf: true },
        },
      }),
    )
    const openaiCompatible = ProviderMediaStrategy.resolve(model())

    expect(google.transport({ mime: "video/mp4", url: "gemini-file://files/video" }).type).toBe("reject")
    expect(google.transport({ mime: "video/mp4", url: "gs://bucket/video.mp4" }).type).toBe("reject")
    expect(google.transport({ mime: "video/mp4", url: "https://youtu.be/abc123" })).toStrictEqual({ type: "url" })

    expect(openaiCompatible.transport({ mime: "video/mp4", url: "gemini-file://files/video" }).type).toBe("reject")
    expect(openaiCompatible.transport({ mime: "video/mp4", url: "gs://bucket/video.mp4" }).type).toBe("reject")
    expect(openaiCompatible.transport({ mime: "video/mp4", url: "https://youtu.be/abc123" }).type).toBe("reject")
  })

  test("uses Gemini Files for Google data audio video and PDF payloads", () => {
    const strategy = ProviderMediaStrategy.resolve(
      model({
        providerID: ProviderID.make("google"),
        api: {
          id: "gemini-3-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
        capabilities: {
          ...model().capabilities,
          input: { ...model().capabilities.input, pdf: true },
        },
      }),
    )

    expect(strategy.transport({ mime: "audio/mpeg", url: "data:audio/mpeg;base64,AAA" })).toStrictEqual({
      type: "gemini-files",
    })
    expect(strategy.transport({ mime: "video/mp4", url: "data:video/mp4;base64,AAA" })).toStrictEqual({
      type: "gemini-files",
    })
    expect(strategy.transport({ mime: "application/pdf", url: "data:application/pdf;base64,AAA" })).toStrictEqual({
      type: "gemini-files",
    })
    expect(strategy.transport({ mime: "image/png", url: "data:image/png;base64,AAA" })).toStrictEqual({ type: "inline" })
  })

  test("uses inline media for OAuth-style Google transports", () => {
    const strategy = ProviderMediaStrategy.resolve(
      model({
        providerID: ProviderID.make("google"),
        api: {
          id: "gemini-3-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
        capabilities: {
          ...model().capabilities,
          input: { ...model().capabilities.input, pdf: true },
        },
      }),
      {
        id: ProviderID.make("google"),
        name: "Google",
        source: "env",
        env: ["GEMINI_API_KEY"],
        key: "env-secret",
        options: { apiKey: "", fetch: async () => new Response() },
        models: {},
      },
    )

    expect(strategy.transport({ mime: "audio/mpeg", url: "data:audio/mpeg;base64,AAA" })).toStrictEqual({
      type: "inline",
    })
    expect(strategy.transport({ mime: "video/mp4", url: "file:///tmp/clip.mp4" })).toStrictEqual({
      type: "inline",
    })
    expect(strategy.transport({ mime: "application/pdf", url: "data:application/pdf;base64,AAA" })).toStrictEqual({
      type: "inline",
    })
    expect(strategy.transport({ mime: "video/mp4", url: "https://youtu.be/abc123" })).toStrictEqual({
      type: "reject",
      reason: "Custom Google transports only support inline file data",
    })
  })

  test("uses Gemini Files for Google local audio video and PDF files", () => {
    const strategy = ProviderMediaStrategy.resolve(
      model({
        providerID: ProviderID.make("google"),
        api: {
          id: "gemini-3-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
        capabilities: {
          ...model().capabilities,
          input: { ...model().capabilities.input, pdf: true },
        },
      }),
    )

    expect(strategy.transport({ mime: "audio/mpeg", url: "file:///tmp/clip.mp3" })).toStrictEqual({
      type: "gemini-files",
    })
    expect(strategy.transport({ mime: "video/mp4", url: "file:///tmp/clip.mp4" })).toStrictEqual({
      type: "gemini-files",
    })
    expect(strategy.transport({ mime: "application/pdf", url: "file:///tmp/doc.pdf" })).toStrictEqual({
      type: "gemini-files",
    })
    expect(strategy.transport({ mime: "image/png", url: "file:///tmp/image.png" })).toStrictEqual({ type: "inline" })
  })

  test("uses URL transport for accepted HTTP and HTTPS URLs", () => {
    const strategy = ProviderMediaStrategy.resolve(model())

    expect(strategy.transport({ mime: "audio/mpeg", url: "http://example.com/audio.mp3" })).toStrictEqual({ type: "url" })
    expect(strategy.transport({ mime: "video/mp4", url: "https://example.com/video.mp4" })).toStrictEqual({ type: "url" })
  })
})
