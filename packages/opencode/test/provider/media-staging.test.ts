import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { streamText } from "ai"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { GeminiMediaStaging } from "../../src/provider/media-staging"
import type { MessageV2 } from "../../src/session/message-v2"

const googleModel: Provider.Model = {
  id: ModelID.make("gemini-3.1-flash-lite"),
  providerID: ProviderID.make("google"),
  api: {
    id: "gemini-3.1-flash-lite",
    url: "https://generativelanguage.googleapis.com",
    npm: "@ai-sdk/google",
  },
  name: "Gemini 3.1 Flash Lite",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: true,
      image: true,
      video: true,
      pdf: true,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
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
}

const provider: Provider.Info = {
  id: ProviderID.make("google"),
  name: "Google",
  source: "env",
  env: ["GEMINI_API_KEY"],
  key: "secret-key",
  options: {},
  models: {},
}

const envOnlyProvider: Provider.Info = {
  ...provider,
  key: undefined,
}

const customFetchProvider: Provider.Info = {
  ...provider,
  options: {
    apiKey: "",
    fetch: async () => new Response(),
  },
}

function userWithFile(url: string, sourcePath = "C:\\media\\clip.mp4", mime = "video/mp4"): MessageV2.WithParts {
  return {
    info: { role: "user", id: "msg", sessionID: "session" } as MessageV2.User,
    parts: [
      {
        id: "part",
        messageID: "msg",
        sessionID: "session",
        type: "file",
        mime,
        filename: "clip.mp4",
        url,
        source: url.startsWith("file:")
          ? {
              type: "file",
              path: sourcePath,
              text: { value: "clip.mp4", start: 0, end: 8 },
            }
          : undefined,
      },
    ] as MessageV2.Part[],
  }
}

function userWithSourceLessFile(url: string): MessageV2.WithParts {
  const message = userWithFile(url)
  const part = message.parts[0] as MessageV2.FilePart
  delete part.source
  return message
}

async function googleParts(fileURL: string) {
  const requests: Array<{ url: string; body: string }> = []
  const google = createGoogleGenerativeAI({
    apiKey: "secret-key",
    baseURL: "https://gemini-proxy.example/v1beta",
    fetch: (async (url, init) => {
      requests.push({ url: url.toString(), body: String(init?.body ?? "") })
      return new Response(
        `data: ${JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "ok" }], role: "model" },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )
    }) as typeof fetch,
  })

  await streamText({
    model: google("gemini-3.1-flash-lite"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "describe the video" },
          { type: "file", data: new URL(fileURL), mediaType: "video/mp4" },
        ],
      },
    ],
  }).text

  return (
    JSON.parse(requests[0].body) as {
      contents: Array<{
        parts: Array<{
          text?: string
          fileData?: { mimeType: string; fileUri: string }
          inlineData?: unknown
        }>
      }>
    }
  ).contents[0].parts
}

describe("GeminiMediaStaging.stageMessages", () => {
  test("uploads Google local media through the injected Gemini Files uploader", async () => {
    const uploads: GeminiMediaStaging.UploadInput[] = []
    const messages = [userWithFile("file:///C:/media/clip.mp4")]

    const result = await GeminiMediaStaging.stageMessages({
      model: googleModel,
      provider,
      messages,
      upload: async (input) => {
        uploads.push(input)
        return {
          uri: "https://generativelanguage.googleapis.com/v1beta/files/video-123",
          name: "files/video-123",
          expiresAt: Date.now() + 60_000,
        }
      },
    })

    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      apiKey: "secret-key",
      mime: "video/mp4",
      filename: "clip.mp4",
      url: "file:///C:/media/clip.mp4",
      sourcePath: "C:\\media\\clip.mp4",
    })
    expect((result[0].parts[0] as MessageV2.FilePart).url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/files/video-123",
    )
    expect((messages[0].parts[0] as MessageV2.FilePart).url).toBe("file:///C:/media/clip.mp4")
  })

  test("passes Google YouTube URLs through without upload", async () => {
    const messages = [userWithFile("https://youtu.be/abc123")]

    const result = await GeminiMediaStaging.stageMessages({
      model: googleModel,
      provider,
      messages,
      upload: async () => {
        throw new Error("unexpected upload")
      },
    })

    expect((result[0].parts[0] as MessageV2.FilePart).url).toBe("https://youtu.be/abc123")
  })

  test("keeps OAuth-style Google transports on inline media instead of Gemini Files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gemini-oauth-inline-"))
    try {
      const file = path.join(dir, "oauth-clip.mp4")
      await fs.writeFile(file, "oauth-video")

      const result = await GeminiMediaStaging.stageMessages({
        model: googleModel,
        provider: customFetchProvider,
        messages: [userWithFile(pathToFileURL(file).href, file)],
        upload: async () => {
          throw new Error("unexpected Gemini Files upload")
        },
      })

      expect((result[0].parts[0] as MessageV2.FilePart).url).toBe(
        `data:video/mp4;base64,${Buffer.from("oauth-video").toString("base64")}`,
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects oversized inline media for OAuth-style Google transports before upload", async () => {
    await expect(
      GeminiMediaStaging.stageMessages({
        model: googleModel,
        provider: customFetchProvider,
        messages: [userWithFile(`data:video/mp4;base64,${Buffer.from("too-large-video").toString("base64")}`)],
        inlineMaxBytes: 8,
        upload: async () => {
          throw new Error("unexpected Gemini Files upload")
        },
      }),
    ).rejects.toThrow("exceeds inline media limit")
  })

  test("does not upload media rejected by model metadata", async () => {
    const result = await GeminiMediaStaging.stageMessages({
      model: {
        ...googleModel,
        capabilities: {
          ...googleModel.capabilities,
          input: { ...googleModel.capabilities.input, audio: false },
        },
      },
      provider,
      messages: [userWithFile("data:audio/mpeg;base64,AAA", "C:\\media\\clip.mp3", "audio/mpeg")],
      upload: async () => {
        throw new Error("unexpected upload")
      },
    })

    expect((result[0].parts[0] as MessageV2.FilePart).url).toBe("data:audio/mpeg;base64,AAA")
  })

  test("normalizes staged file URIs to custom Google baseURL so AI SDK does not download them", async () => {
    const result = await GeminiMediaStaging.stageMessages({
      model: googleModel,
      provider: {
        ...provider,
        options: {
          baseURL: "https://gemini-proxy.example/v1beta",
        },
      },
      messages: [userWithFile("file:///C:/media/clip.mp4")],
      upload: async () => ({
        uri: "https://generativelanguage.googleapis.com/v1beta/files/video-123",
        name: "files/video-123",
        expiresAt: Date.now() + 60_000,
      }),
    })

    expect((result[0].parts[0] as MessageV2.FilePart).url).toBe("https://gemini-proxy.example/v1beta/files/video-123")
  })

  test("uploads data URLs with the Gemini Files resumable protocol and waits for ACTIVE files", async () => {
    const requests: Array<{ url: string; headers: Record<string, string | null>; body?: string }> = []
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString()
      requests.push({
        url: requestUrl,
        headers: {
          apiKey: new Headers(init?.headers).get("x-goog-api-key"),
          command: new Headers(init?.headers).get("x-goog-upload-command"),
          contentType: new Headers(init?.headers).get("x-goog-upload-header-content-type"),
          contentLength: new Headers(init?.headers).get("x-goog-upload-header-content-length"),
        },
        body: typeof init?.body === "string" ? init.body : undefined,
      })

      if (requestUrl.endsWith("/upload/v1beta/files")) {
        return new Response(null, {
          headers: { "x-goog-upload-url": "https://upload.example.com/session" },
        })
      }
      if (requestUrl === "https://upload.example.com/session") {
        return Response.json({
          file: {
            name: "files/video-123",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/video-123",
            state: "PROCESSING",
          },
        })
      }
      if (requestUrl.endsWith("/v1beta/files/video-123")) {
        return Response.json({
          file: {
            name: "files/video-123",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/video-123",
            state: "ACTIVE",
          },
        })
      }
      return Response.json({}, { status: 404 })
    }

    const result = await GeminiMediaStaging.upload({
      apiKey: "secret-key",
      baseURL: "https://generativelanguage.googleapis.com",
      mime: "video/mp4",
      filename: "clip.mp4",
      url: `data:video/mp4;base64,${Buffer.from("video").toString("base64")}`,
      fetch: fetcher as typeof fetch,
      sleep: async () => {},
    })

    expect(result.uri).toBe("https://generativelanguage.googleapis.com/v1beta/files/video-123")
    expect(requests.map((request) => request.headers.command)).toEqual(["start", "upload, finalize", null])
    expect(requests[0]).toMatchObject({
      url: "https://generativelanguage.googleapis.com/upload/v1beta/files",
      headers: {
        apiKey: "secret-key",
        contentType: "video/mp4",
        contentLength: "5",
      },
      body: JSON.stringify({ file: { display_name: "clip.mp4" } }),
    })
  })

  test("fails when Gemini Files processing ends in a non-active state", async () => {
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString()
      if (requestUrl.endsWith("/upload/v1beta/files")) {
        return new Response(null, {
          headers: { "x-goog-upload-url": "https://upload.example.com/session" },
        })
      }
      if (requestUrl === "https://upload.example.com/session") {
        return Response.json({
          file: {
            name: "files/failed-video",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/failed-video",
            state: "FAILED",
          },
        })
      }
      throw new Error(`unexpected request ${requestUrl} ${init?.method ?? "GET"}`)
    }

    await expect(
      GeminiMediaStaging.upload({
        apiKey: "secret-key",
        baseURL: "https://generativelanguage.googleapis.com",
        mime: "video/mp4",
        filename: "clip.mp4",
        url: `data:video/mp4;base64,${Buffer.from("video").toString("base64")}`,
        fetch: fetcher as typeof fetch,
        sleep: async () => {},
      }),
    ).rejects.toThrow("FAILED")
  })

  test("caches staged Gemini file metadata by media content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gemini-cache-"))
    try {
      let uploads = 0
      const file = path.join(dir, "clip.mp4")
      await fs.writeFile(file, "same-video")
      const messages = [userWithFile(pathToFileURL(file).href, file)]
      const input = {
        model: googleModel,
        provider,
        messages,
        cachePath: path.join(dir, "gemini-files.json"),
        upload: async () => {
          uploads++
          return {
            uri: "https://generativelanguage.googleapis.com/v1beta/files/cached-video",
            name: "files/cached-video",
            expiresAt: Date.now() + 120_000,
          }
        },
      }

      expect(((await GeminiMediaStaging.stageMessages(input))[0].parts[0] as MessageV2.FilePart).url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/files/cached-video",
      )
      expect(((await GeminiMediaStaging.stageMessages(input))[0].parts[0] as MessageV2.FilePart).url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/files/cached-video",
      )
      expect(uploads).toBe(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("uses provider env names when Google API key was not copied into provider.key", async () => {
    const original = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = "env-secret-key"
    try {
      const uploads: GeminiMediaStaging.UploadInput[] = []
      const result = await GeminiMediaStaging.stageMessages({
        model: googleModel,
        provider: envOnlyProvider,
        messages: [userWithFile("file:///C:/media/clip.mp4")],
        upload: async (input) => {
          uploads.push(input)
          return {
            uri: "https://generativelanguage.googleapis.com/v1beta/files/env-key-video",
            name: "files/env-key-video",
            expiresAt: Date.now() + 120_000,
          }
        },
      })

      expect(uploads[0].apiKey).toBe("env-secret-key")
      expect((result[0].parts[0] as MessageV2.FilePart).url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/files/env-key-video",
      )
    } finally {
      if (original === undefined) delete process.env.GEMINI_API_KEY
      else process.env.GEMINI_API_KEY = original
    }
  })

  test("reads source-less file URLs from the file URL path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gemini-file-url-"))
    try {
      const file = path.join(dir, "source-less.mp4")
      await fs.writeFile(file, "source-less-video")
      const uploads: GeminiMediaStaging.UploadInput[] = []
      const result = await GeminiMediaStaging.stageMessages({
        model: googleModel,
        provider,
        messages: [userWithSourceLessFile(pathToFileURL(file).href)],
        upload: async (input) => {
          uploads.push(input)
          return {
            uri: "https://generativelanguage.googleapis.com/v1beta/files/source-less-video",
            name: "files/source-less-video",
            expiresAt: Date.now() + 120_000,
          }
        },
      })

      expect(uploads[0].sourcePath).toBe(file)
      expect((result[0].parts[0] as MessageV2.FilePart).url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/files/source-less-video",
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("AI SDK serializes staged Gemini Files URLs as fileData.fileUri", async () => {
    const parts = await googleParts("https://gemini-proxy.example/v1beta/files/video-123")

    expect(parts[1]).toEqual({
      fileData: {
        mimeType: "video/mp4",
        fileUri: "https://gemini-proxy.example/v1beta/files/video-123",
      },
    })
    expect(parts[1].inlineData).toBeUndefined()
  })

  test("AI SDK serializes YouTube URLs as URL-backed fileData.fileUri", async () => {
    const parts = await googleParts("https://youtu.be/abc123")

    expect(parts[1]).toEqual({
      fileData: {
        mimeType: "video/mp4",
        fileUri: "https://youtu.be/abc123",
      },
    })
    expect(parts[1].inlineData).toBeUndefined()
  })

  test("AI SDK serializes custom Google inline data URLs as inlineData", async () => {
    const parts = await googleParts(`data:video/mp4;base64,${Buffer.from("oauth-video").toString("base64")}`)

    expect(parts[1]).toEqual({
      inlineData: {
        mimeType: "video/mp4",
        data: Buffer.from("oauth-video").toString("base64"),
      },
    })
    expect(parts[1].fileData).toBeUndefined()
  })
})
