# OpenCode Multimodal Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build metadata-driven audio and video input support across every OpenCode entry mode that can submit file parts.

**Architecture:** Extend the existing `FilePart` pipeline instead of adding new message part kinds. All entry modes produce the same prompt file parts; model metadata decides whether a modality is supported; provider strategy decides how to transport it safely.

**Tech Stack:** Bun, TypeScript, Effect, AI SDK v6, SolidJS, Electron, OpenCode generated SDK, OpenCode HTTP API.

---

## Scope And Boundaries

This plan implements core multimodal plumbing, all-mode entry support, shared app UI support, and non-secret tests. Protected live experiments are added as manual scripts or documented commands, but they must not run automatically or require secrets in CI.

Do not add model-specific code for older MiMo variants. The implementation must be metadata-driven: every provider/model with `audio` and/or `video` input metadata can use the same path once the provider strategy allows the transport.

## File Structure

- Modify `packages/opencode/src/util/media.ts`: shared audio/video/PDF/image classification and MIME sniffing.
- Create `packages/opencode/test/util/media.test.ts`: media classifier tests.
- Modify `packages/opencode/src/config/attachment.ts`: audio/video attachment config schema.
- Modify `packages/opencode/test/config/config.test.ts` or create `packages/opencode/test/config/attachment.test.ts`: config schema tests.
- Modify `packages/opencode/src/tool/read.ts`: return audio/video tool attachments.
- Modify `packages/opencode/test/tool/read.test.ts`: audio/video read tool tests.
- Modify `packages/opencode/src/session/prompt.ts`: keep file-part prompt resolution metadata-driven and enforce attachment limits.
- Modify `packages/opencode/test/session/prompt.test.ts`: prompt resolution tests for audio/video local files.
- Modify `packages/opencode/src/session/message-v2.ts`: ensure user and tool-result audio/video parts convert correctly and strip/media behavior is general.
- Modify `packages/opencode/test/session/message-v2.test.ts`: conversion, `stripMedia`, and tool-result media tests.
- Create `packages/opencode/src/provider/media-strategy.ts`: provider/model transport resolver.
- Create `packages/opencode/test/provider/media-strategy.test.ts`: provider strategy tests.
- Modify `packages/opencode/src/provider/transform.ts`: use strategy for unsupported modality/transport messaging where needed.
- Modify `packages/opencode/test/provider/transform.test.ts`: visual-only video and unsupported transport tests.
- Modify `packages/opencode/src/cli/cmd/run.ts`: detect real MIME for `opencode run --file`.
- Create or modify `packages/opencode/test/cli/run/file-attachment.test.ts`: CLI file MIME tests.
- Modify TUI prompt files under `packages/opencode/src/cli/cmd/tui/`: accept audio/video path-paste and render compact labels.
- Modify `packages/opencode/test/cli/cmd/tui/prompt-part.test.ts`: TUI prompt part tests.
- Modify `packages/app/src/constants/file-picker.ts`: app accepted audio/video MIME types and extensions.
- Modify `packages/app/src/components/prompt-input/files.ts`: browser-side attachment MIME detection.
- Modify `packages/app/src/context/prompt.tsx`: rename image-only prompt attachment type to media attachment type.
- Modify `packages/app/src/components/prompt-input/attachments.ts`: app drag/drop/paste media handling.
- Move or replace `packages/app/src/components/prompt-input/image-attachments.tsx` with `packages/app/src/components/prompt-input/media-attachments.tsx`: shared media attachment strip.
- Modify `packages/app/src/components/prompt-input/build-request-parts.ts`: build SDK file parts for all media attachments.
- Modify `packages/app/src/components/prompt-input.tsx`: wire media attachments in the shared web/desktop prompt UI.
- Modify existing app prompt tests under `packages/app/src/components/prompt-input/*.test.ts`: shared app media tests.
- Modify `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts`: add authenticated browser/desktop media upload storage returning server-local file parts.
- Regenerate `packages/sdk/js` by running `./packages/sdk/js/script/build.ts` from repo root after schema changes.
- Create `packages/opencode/script/multimodal-live.ts`: protected manual live experiment runner that reads credentials only from existing auth/env paths and redacts output.

---

### Task 1: Media Classification

**Files:**
- Modify: `packages/opencode/src/util/media.ts`
- Create: `packages/opencode/test/util/media.test.ts`

- [x] **Step 1: Write failing media classifier tests**

Create `packages/opencode/test/util/media.test.ts`:

```ts
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
    expect(isMedia("audio/wav")).toBe(true)
    expect(isMedia("video/webm")).toBe(true)
    expect(isMedia("text/plain")).toBe(false)
  })

  test("sniffs common audio and video signatures", () => {
    expect(sniffAttachmentMime(Uint8Array.from([0x49, 0x44, 0x33, 0, 0]), "application/octet-stream")).toBe(
      "audio/mpeg",
    )
    expect(sniffAttachmentMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), "")).toBe(
      "audio/wav",
    )
    expect(sniffAttachmentMime(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), "")).toBe("video/mp4")
    expect(sniffAttachmentMime(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), "")).toBe("video/webm")
  })
})
```

- [x] **Step 2: Run the focused test and confirm failure**

Run from `packages/opencode`:

```bash
bun test test/util/media.test.ts
```

Expected: FAIL because `isAudioAttachment` and `isVideoAttachment` are not exported.

- [x] **Step 3: Implement media classification**

Update `packages/opencode/src/util/media.ts`:

```ts
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)

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
  if (startsWith(bytes, [0xff, 0xfb]) || startsWith(bytes, [0xff, 0xf3]) || startsWith(bytes, [0xff, 0xf2])) {
    return "audio/mpeg"
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x41, 0x56, 0x45])) {
    return "audio/wav"
  }
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg"
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"
  if (startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) return "video/mp4"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x41, 0x56, 0x49, 0x20])) {
    return "video/x-msvideo"
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp"
  }

  return fallback
}
```

- [x] **Step 4: Run the focused test and typecheck**

Run from `packages/opencode`:

```bash
bun test test/util/media.test.ts
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 5: Commit**

```bash
git add packages/opencode/src/util/media.ts packages/opencode/test/util/media.test.ts
git commit -m "feat: classify audio and video attachments"
```

### Task 2: Attachment Config

**Files:**
- Modify: `packages/opencode/src/config/attachment.ts`
- Create: `packages/opencode/test/config/attachment.test.ts`

- [x] **Step 1: Write failing config tests**

Create `packages/opencode/test/config/attachment.test.ts`:

```ts
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
```

- [x] **Step 2: Run the focused test and confirm failure**

Run from `packages/opencode`:

```bash
bun test test/config/attachment.test.ts
```

Expected: FAIL because `audio` and `video` are not in `ConfigAttachment.Info`.

- [x] **Step 3: Add audio/video config schemas**

Update `packages/opencode/src/config/attachment.ts` by adding these schemas after `Image` and before `Info`:

```ts
export const Audio = Schema.Struct({
  max_base64_bytes: Schema.optional(PositiveInt).annotate({
    description: "Maximum base64 payload bytes for an audio attachment (default: 20971520)",
  }),
  max_duration_seconds: Schema.optional(PositiveInt).annotate({
    description: "Maximum audio duration in seconds when duration can be measured cheaply (default: 3600)",
  }),
})
  .annotate({ identifier: "AudioAttachmentConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Audio = Schema.Schema.Type<typeof Audio>

export const Video = Schema.Struct({
  max_base64_bytes: Schema.optional(PositiveInt).annotate({
    description: "Maximum base64 payload bytes for a video attachment (default: 20971520)",
  }),
  max_duration_seconds: Schema.optional(PositiveInt).annotate({
    description: "Maximum video duration in seconds when duration can be measured cheaply (default: 60)",
  }),
})
  .annotate({ identifier: "VideoAttachmentConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Video = Schema.Schema.Type<typeof Video>
```

Update `Info`:

```ts
export const Info = Schema.Struct({
  image: Schema.optional(Image).annotate({ description: "Image attachment configuration" }),
  audio: Schema.optional(Audio).annotate({ description: "Audio attachment configuration" }),
  video: Schema.optional(Video).annotate({ description: "Video attachment configuration" }),
})
  .annotate({ identifier: "AttachmentConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
```

- [x] **Step 4: Run config tests and typecheck**

Run from `packages/opencode`:

```bash
bun test test/config/attachment.test.ts
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 5: Commit**

```bash
git add packages/opencode/src/config/attachment.ts packages/opencode/test/config/attachment.test.ts
git commit -m "feat: add audio and video attachment config"
```

### Task 3: Read Tool And Prompt Resolution

**Files:**
- Modify: `packages/opencode/src/tool/read.ts`
- Modify: `packages/opencode/test/tool/read.test.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/test/session/prompt.test.ts`

- [x] **Step 1: Add read tool tests for audio/video attachments**

Append to `packages/opencode/test/tool/read.test.ts`:

```ts
describe("tool.read media attachments", () => {
  it.live("returns audio files as file attachments", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const file = path.join(dir, "sound.mp3")
      yield* put(file, Uint8Array.from([0x49, 0x44, 0x33, 0, 0, 0, 0]))

      const result = yield* exec(dir, { filePath: file })

      expect(result.output).toBe("Audio read successfully")
      expect(result.attachments?.[0]?.mime).toBe("audio/mpeg")
      expect(result.attachments?.[0]?.url).toStartWith("data:audio/mpeg;base64,")
    }),
  )

  it.live("returns video files as file attachments", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const file = path.join(dir, "clip.mp4")
      yield* put(file, Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))

      const result = yield* exec(dir, { filePath: file })

      expect(result.output).toBe("Video read successfully")
      expect(result.attachments?.[0]?.mime).toBe("video/mp4")
      expect(result.attachments?.[0]?.url).toStartWith("data:video/mp4;base64,")
    }),
  )
})
```

- [x] **Step 2: Run focused read tests and confirm failure**

Run from `packages/opencode`:

```bash
bun test test/tool/read.test.ts --grep "media attachments"
```

Expected: FAIL because audio/video are treated as binary files.

- [x] **Step 3: Update read tool media handling**

Modify imports in `packages/opencode/src/tool/read.ts`:

```ts
import { isAudioAttachment, isImageAttachment, isPdfAttachment, isVideoAttachment, sniffAttachmentMime } from "@/util/media"
```

Replace the existing `SUPPORTED_IMAGE_MIMES` constant and image/PDF branch with:

```ts
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

function mediaReadMessage(mime: string) {
  if (isPdfAttachment(mime)) return "PDF read successfully"
  if (isAudioAttachment(mime)) return "Audio read successfully"
  if (isVideoAttachment(mime)) return "Video read successfully"
  return "Image read successfully"
}
```

In `run`, replace:

```ts
const isImage = SUPPORTED_IMAGE_MIMES.has(mime)

if (isImage || isPdfAttachment(mime)) {
```

with:

```ts
const supportedMedia =
  (isImageAttachment(mime) && SUPPORTED_IMAGE_MIMES.has(mime)) ||
  isPdfAttachment(mime) ||
  isAudioAttachment(mime) ||
  isVideoAttachment(mime)

if (supportedMedia) {
```

Replace the message assignment inside that branch:

```ts
const msg = mediaReadMessage(mime)
```

- [x] **Step 4: Add prompt resolution tests for audio/video `file:` URLs**

In `packages/opencode/test/session/prompt.test.ts`, add tests near existing file prompt resolution tests:

```ts
test("resolves audio file prompt part into a data URL file part", async () => {
  const dir = await usingTmpdir()
  const audio = path.join(dir, "sound.mp3")
  await Bun.write(audio, Uint8Array.from([0x49, 0x44, 0x33, 0, 0, 0, 0]))

  const result = await prompt({
    directory: dir,
    parts: [{ type: "file", mime: "audio/mpeg", url: pathToFileURL(audio).href, filename: "sound.mp3" }],
  })

  const part = result.parts.find((part) => part.type === "file")
  expect(part?.type).toBe("file")
  if (part?.type === "file") {
    expect(part.mime).toBe("audio/mpeg")
    expect(part.url).toStartWith("data:audio/mpeg;base64,")
  }
})

test("resolves video file prompt part into a data URL file part", async () => {
  const dir = await usingTmpdir()
  const video = path.join(dir, "clip.mp4")
  await Bun.write(video, Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))

  const result = await prompt({
    directory: dir,
    parts: [{ type: "file", mime: "video/mp4", url: pathToFileURL(video).href, filename: "clip.mp4" }],
  })

  const part = result.parts.find((part) => part.type === "file")
  expect(part?.type).toBe("file")
  if (part?.type === "file") {
    expect(part.mime).toBe("video/mp4")
    expect(part.url).toStartWith("data:video/mp4;base64,")
  }
})
```

Use existing fixture helpers in `prompt.test.ts`; if the file uses different helper names, adapt only the wrapper setup and keep assertions unchanged.

- [x] **Step 5: Implement prompt media limit checks**

In `packages/opencode/src/session/prompt.ts`, when resolving binary `file:` parts, compute the media class with `isAudioAttachment` and `isVideoAttachment` from `@/util/media`. Apply defaults:

```ts
const defaultMaxBase64Bytes = (mime: string) => {
  if (mime.startsWith("audio/")) return 20 * 1024 * 1024
  if (mime.startsWith("video/")) return 20 * 1024 * 1024
  return 4.5 * 1024 * 1024
}
```

Before storing a data URL for audio/video, fail with:

```ts
throw new Error(`Attachment ${part.filename ?? part.url} exceeds ${limit} bytes for ${mime}`)
```

Use the existing config service already available in `prompt.ts`; do not add a new config loader.

- [x] **Step 6: Run prompt/read tests and typecheck**

Run from `packages/opencode`:

```bash
bun test test/tool/read.test.ts --grep "media attachments"
bun test test/session/prompt.test.ts --grep "audio file|video file"
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 7: Commit**

```bash
git add packages/opencode/src/tool/read.ts packages/opencode/test/tool/read.test.ts packages/opencode/src/session/prompt.ts packages/opencode/test/session/prompt.test.ts
git commit -m "feat: resolve audio and video file parts"
```

### Task 4: Provider Media Strategy

**Files:**
- Create: `packages/opencode/src/provider/media-strategy.ts`
- Create: `packages/opencode/test/provider/media-strategy.test.ts`
- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: `packages/opencode/test/session/message-v2.test.ts`

- [x] **Step 1: Write provider strategy tests**

Create `packages/opencode/test/provider/media-strategy.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ProviderMediaStrategy } from "../../src/provider/media-strategy"

const baseModel = {
  providerID: "opencode-go",
  api: { npm: "@ai-sdk/openai-compatible", id: "mimo-v2.5", url: "https://opencode.ai/zen/go/v1" },
  capabilities: {
    input: { text: true, image: true, audio: true, video: true, pdf: false },
  },
} as any

describe("ProviderMediaStrategy.resolve", () => {
  test("allows metadata-backed inline audio and video for OpenCode Go candidates", () => {
    const strategy = ProviderMediaStrategy.resolve(baseModel)

    expect(strategy.accepted.audio).toBe(true)
    expect(strategy.accepted.video).toBe(true)
    expect(strategy.schemes).toContain("data")
    expect(strategy.transport({ mime: "audio/mpeg", bytes: 1024, url: "data:audio/mpeg;base64,AAA" }).type).toBe(
      "inline",
    )
    expect(strategy.transport({ mime: "video/mp4", bytes: 1024, url: "data:video/mp4;base64,AAA" }).type).toBe(
      "inline",
    )
  })

  test("marks Kimi video as visual-only when metadata lacks audio", () => {
    const strategy = ProviderMediaStrategy.resolve({
      ...baseModel,
      api: { ...baseModel.api, id: "kimi-k2.6" },
      capabilities: { input: { text: true, image: true, audio: false, video: true, pdf: false } },
    })

    expect(strategy.accepted.video).toBe(true)
    expect(strategy.videoAudio).toBe("visual-only")
  })

  test("rejects audio when model metadata lacks audio", () => {
    const strategy = ProviderMediaStrategy.resolve({
      ...baseModel,
      capabilities: { input: { text: true, image: true, audio: false, video: true, pdf: false } },
    })

    expect(strategy.transport({ mime: "audio/mpeg", bytes: 1024, url: "data:audio/mpeg;base64,AAA" })).toEqual({
      type: "reject",
      reason: "Model metadata does not include audio input support.",
    })
  })
})
```

- [x] **Step 2: Run strategy tests and confirm failure**

Run from `packages/opencode`:

```bash
bun test test/provider/media-strategy.test.ts
```

Expected: FAIL because `provider/media-strategy.ts` does not exist.

- [x] **Step 3: Implement provider media strategy**

Create `packages/opencode/src/provider/media-strategy.ts`:

```ts
export * as ProviderMediaStrategy from "./media-strategy"

import type { Provider } from "./provider"

type Modality = "audio" | "image" | "pdf" | "text" | "video"
type Scheme = "data" | "file" | "http" | "https" | "gemini-file" | "gs" | "youtube"

export type VideoAudio = "preserved" | "visual-only" | "reject-if-audio" | "unknown"

export type Transport =
  | { type: "inline" }
  | { type: "gemini-files" }
  | { type: "url" }
  | { type: "reject"; reason: string }

export type Strategy = {
  accepted: Record<Modality, boolean>
  schemes: Scheme[]
  videoAudio: VideoAudio
  transport(input: { mime: string; bytes?: number; url: string }): Transport
}

function modality(mime: string): Modality | undefined {
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

function accepted(model: Provider.Model): Record<Modality, boolean> {
  return {
    text: model.capabilities.input.text,
    image: model.capabilities.input.image,
    audio: model.capabilities.input.audio,
    video: model.capabilities.input.video,
    pdf: model.capabilities.input.pdf,
  }
}

function scheme(url: string): Scheme | undefined {
  if (url.startsWith("data:")) return "data"
  if (url.startsWith("file:")) return "file"
  if (url.startsWith("http://")) return "http"
  if (url.startsWith("https://www.youtube.com/") || url.startsWith("https://youtu.be/")) return "youtube"
  if (url.startsWith("https://")) return "https"
  if (url.startsWith("gemini-file:")) return "gemini-file"
  if (url.startsWith("gs://")) return "gs"
  return undefined
}

export function resolve(model: Provider.Model): Strategy {
  const input = accepted(model)
  const google = model.api.npm === "@ai-sdk/google"
  const schemes: Scheme[] = google
    ? ["data", "file", "https", "gemini-file", "gs", "youtube"]
    : ["data", "file", "http", "https"]
  const videoAudio: VideoAudio = input.video && !input.audio ? "visual-only" : input.video ? "preserved" : "unknown"

  return {
    accepted: input,
    schemes,
    videoAudio,
    transport(part) {
      const partModality = modality(part.mime)
      if (!partModality) return { type: "reject", reason: `Unsupported attachment MIME type: ${part.mime}` }
      if (!input[partModality]) {
        return { type: "reject", reason: `Model metadata does not include ${partModality} input support.` }
      }

      const partScheme = scheme(part.url)
      if (!partScheme || !schemes.includes(partScheme)) {
        return { type: "reject", reason: `Provider strategy does not accept ${part.url.split(":", 1)[0] || "unknown"} URLs.` }
      }

      if (google && partScheme === "data" && part.bytes && part.bytes > 100 * 1024 * 1024) return { type: "gemini-files" }
      if (partScheme === "data" || partScheme === "file") return { type: "inline" }
      return { type: "url" }
    },
  }
}
```

- [x] **Step 3a: Add Gemini Files API staging**

Before provider message conversion for `@ai-sdk/google`, add a Google API-key-only staging layer that prefers Gemini Files API for local audio/video/PDF media where supported. It must:

- Upload local media through Gemini Files API using existing OpenCode auth/config/env credentials.
- Poll processing state before sending video/audio that requires server-side processing.
- Cache upload metadata outside the repo by content hash, provider, MIME, size, and expiry.
- Convert staged media into AI SDK URL-backed file parts pointing at the returned Gemini file URL/URI, so the current Google provider serializes them as `fileData.fileUri`.
- Preserve inline data URL handling for explicit inline callers, tiny test fixtures, and non-Google strategies.
- Redact upload URLs, file URIs, credentials, and media bytes from logs/tests unless explicitly running local verbose debugging.

- [x] **Step 3b: Add Gemini Files API and YouTube request-shape tests**

Add fake-HTTP/provider-shape tests that prove:

- Large Google media chooses the Gemini Files API staging path.
- Staged Gemini file URLs are passed to AI SDK as URL-backed file parts.
- `https://www.youtube.com/watch?...` and `https://youtu.be/...` are accepted for `@ai-sdk/google`, rejected for non-Google strategies unless explicitly supported, and pass through without local download or base64 conversion.
- The 69 MB Teams MP4 live fixture is routed to Files API in protected live mode.

2026-05-13 implementation result: added Google/Gemini media staging before AI SDK message conversion. Google local audio/video/PDF file URLs now select `gemini-files`, local Google video attachments stay as `file://` with source metadata instead of being base64-expanded, and large Google data video URLs bypass the base64 safety rejection so the staging layer can upload them. The staging helper uploads with the Gemini Files resumable REST protocol, polls `PROCESSING` files until they become non-processing, caches successful upload metadata under the OpenCode global cache by content hash/MIME/size/API root/expiry, and leaves YouTube URLs as URL-backed file parts without upload. Focused verification passed from `packages/opencode`: `bun test test/provider/media-staging.test.ts test/provider/media-strategy.test.ts`, targeted prompt media tests, and `bun typecheck`.

2026-05-13 protected live result: aliased `GOOGLE_GENERATIVE_AI_API_KEY` from the existing `GEMINI_API_KEY` only inside the local experiment process and staged the user-supplied 72,198,691-byte Teams MP4 through the real Gemini Files API. The first live attempt exposed an incorrect poll URL (`/v1beta/files/{name}` when Gemini returned a name that already included `files/...`); fixed it to poll `/v1beta/{name}` and covered that in the fake-HTTP test. The rerun completed in about 101 seconds, returned a staged file URL internally, and wrote the global cache entry without printing secrets, upload URLs, file URIs, or media bytes. A follow-up `opencode run --attach` against a fresh local server completed with exit code 0 against the cached file, but produced no stdout text, so the verified live claim for this step is Files API staging/cache success rather than semantic model-answer validation.

2026-05-13 review follow-up: subagent review found two staging boundary bugs. Fixed env-only Google auth by resolving API keys from provider `options.apiKey`, `provider.key`, or the provider's declared env names, and fixed source-less `file://` media by deriving the upload path from the file URL when `MessageV2.FilePart.source` is absent. Added regression tests for both cases. Focused verification remains green from `packages/opencode`: `bun test test/provider/media-staging.test.ts test/provider/media-strategy.test.ts`, targeted prompt media tests, and `bun typecheck`.

2026-05-13 final review follow-up: GPT-5.5 xhigh code review found no critical issues and four important pre-merge issues. Fixed restored uploaded media with `source` metadata so it remains a media attachment instead of becoming text context, narrowed Google URL strategy to AI-SDK-serializable HTTPS/YouTube plus local/data Gemini Files staging, made committed Codex hook paths repo-relative, and added server-side upload MIME/size gates with old-upload cleanup. Also covered app upload failure and preview object URL cleanup. Focused verification passed from `packages/app`: `bun test src/components/prompt-input/attachments.test.ts src/components/prompt-input/submit.test.ts src/components/prompt-input/build-request-parts.test.ts src/utils/prompt.test.ts src/components/prompt-input/history.test.ts` and `bun typecheck`; from `packages/opencode`: `bun test test/provider/media-staging.test.ts test/provider/media-strategy.test.ts test/server/httpapi-file.test.ts --timeout 20000` and `bun typecheck`.

2026-05-14 OAuth gateway follow-up: researched the current `opencode-gemini-auth` and `opencode-antigravity-auth` repos. Both register against the normal `google` provider, return `apiKey: ""`, and inject a custom fetch that rewrites `generativelanguage.googleapis.com` model calls to Google Code Assist / Antigravity `v1internal:{generateContent,streamGenerateContent}` endpoints; neither exposes Gemini Files API upload routes. Updated provider media strategy so this OAuth-style Google transport does not use Gemini Files, rejects YouTube/remote URL media for that path, and converts local/data audio/video/PDF to inline data with a conservative 50 MB guard. Added regression tests proving AI SDK emits `inlineData` for the OAuth-style path and `fileData.fileUri` for API-key Gemini Files/YouTube paths. Focused verification passed from `packages/opencode`: `bun test test/provider/media-strategy.test.ts`, `bun test test/provider/media-staging.test.ts`, `bun test test/session/prompt.test.ts -t "resolves Google custom fetch local video file URLs to data URLs"`, and `bun typecheck`. Full `test/session/prompt.test.ts` still has unrelated timeout-prone cancellation cases on this Windows run, so focused prompt verification was used for this change.

- [x] **Step 4: Add model-message tests for audio/video**

Append to `packages/opencode/test/session/message-v2.test.ts`:

```ts
describe("session.message-v2 audio and video parts", () => {
  const mediaModel = {
    ...model,
    capabilities: {
      ...model.capabilities,
      attachment: true,
      input: { text: true, image: true, audio: true, video: true, pdf: true },
    },
  } satisfies Provider.Model

  test("converts user audio and video file parts into AI SDK file content", async () => {
    const messageID = "m-media"
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          { ...basePart(messageID, "p1"), type: "file", mime: "audio/mpeg", url: "data:audio/mpeg;base64,AAA" },
          { ...basePart(messageID, "p2"), type: "file", mime: "video/mp4", url: "data:video/mp4;base64,BBB" },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, mediaModel)).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "file", data: "data:audio/mpeg;base64,AAA", mediaType: "audio/mpeg" },
          { type: "file", data: "data:video/mp4;base64,BBB", mediaType: "video/mp4" },
        ],
      },
    ])
  })

  test("stripMedia removes audio and video parts", async () => {
    const messageID = "m-strip-media"
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          { ...basePart(messageID, "p1"), type: "text", text: "summarize" },
          { ...basePart(messageID, "p2"), type: "file", mime: "audio/mpeg", url: "data:audio/mpeg;base64,AAA" },
          { ...basePart(messageID, "p3"), type: "file", mime: "video/mp4", url: "data:video/mp4;base64,BBB" },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, mediaModel, { stripMedia: true })).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "summarize" }] },
    ])
  })
})
```

- [x] **Step 5: Wire message conversion to strategy**

In `packages/opencode/src/session/message-v2.ts`, import:

```ts
import { ProviderMediaStrategy } from "@/provider/media-strategy"
```

Replace hard-coded media-in-tool-result logic with:

```ts
const strategy = ProviderMediaStrategy.resolve(model)
const supportsMediaInToolResult = (attachment: { mime: string; url?: string }) => {
  if (model.api.npm !== "@ai-sdk/anthropic" && model.api.npm !== "@ai-sdk/google-vertex/anthropic") return false
  return strategy.transport({ mime: attachment.mime, url: attachment.url ?? "data:" }).type !== "reject"
}
```

Keep existing user file conversion shape:

```ts
{
  type: "file",
  data: part.url,
  mediaType: part.mime,
  filename: part.filename,
}
```

- [x] **Step 6: Run strategy and message tests**

Run from `packages/opencode`:

```bash
bun test test/provider/media-strategy.test.ts
bun test test/session/message-v2.test.ts --grep "audio and video parts"
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 7: Commit**

```bash
git add packages/opencode/src/provider/media-strategy.ts packages/opencode/test/provider/media-strategy.test.ts packages/opencode/src/session/message-v2.ts packages/opencode/test/session/message-v2.test.ts
git commit -m "feat: add provider media strategy"
```

### Task 5: CLI And TUI Entry Modes

**Files:**
- Modify: `packages/opencode/src/cli/cmd/run.ts`
- Create: `packages/opencode/test/cli/run/file-attachment.test.ts`
- Modify: TUI prompt path handling under `packages/opencode/src/cli/cmd/tui/`
- Modify: `packages/opencode/test/cli/cmd/tui/prompt-part.test.ts`

- [x] **Step 1: Extract CLI file MIME helper and write tests**

Create `packages/opencode/test/cli/run/file-attachment.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { resolveFilePartForRun } from "../../../src/cli/cmd/run"
import path from "path"

describe("resolveFilePartForRun", () => {
  test("detects audio and video MIME for --file", async () => {
    const dir = await Bun.fileURLToPath(new URL(".", import.meta.url))
    const audio = path.join(dir, "fixture-audio.mp3")
    const video = path.join(dir, "fixture-video.mp4")
    await Bun.write(audio, Uint8Array.from([0x49, 0x44, 0x33, 0, 0]))
    await Bun.write(video, Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))

    expect((await resolveFilePartForRun(audio)).mime).toBe("audio/mpeg")
    expect((await resolveFilePartForRun(video)).mime).toBe("video/mp4")

    await Promise.all([Bun.file(audio).delete(), Bun.file(video).delete()])
  })
})
```

- [x] **Step 2: Run focused CLI test and confirm failure**

Run from `packages/opencode`:

```bash
bun test test/cli/run/file-attachment.test.ts
```

Expected: FAIL because `resolveFilePartForRun` is not exported.

- [x] **Step 3: Implement CLI file MIME helper**

In `packages/opencode/src/cli/cmd/run.ts`, add:

```ts
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { sniffAttachmentMime } from "@/util/media"
```

Export helper near `type FilePart`:

```ts
export async function resolveFilePartForRun(resolvedPath: string): Promise<FilePart> {
  const mime = (await Filesystem.isDir(resolvedPath))
    ? "application/x-directory"
    : sniffAttachmentMime(new Uint8Array(await Bun.file(resolvedPath).slice(0, 4096).arrayBuffer()), AppFileSystem.mimeType(resolvedPath))

  return {
    type: "file",
    url: pathToFileURL(resolvedPath).href,
    filename: path.basename(resolvedPath),
    mime,
  }
}
```

Replace the existing `mime` and `files.push` block with:

```ts
files.push(await resolveFilePartForRun(resolvedPath))
```

- [x] **Step 4: Update TUI path-paste acceptance**

Find TUI prompt file attachment validation with:

```bash
rg -n "image|pdf|application/pdf|clipboard|paste|file:" packages/opencode/src/cli/cmd/tui
```

Where the code accepts image/PDF paths, use the same `sniffAttachmentMime` and `isMedia` functions from `@/util/media`. The accepted condition must be:

```ts
if (isMedia(mime)) {
  return {
    type: "file" as const,
    mime,
    url: pathToFileURL(filepath).href,
    filename: path.basename(filepath),
  }
}
```

Render labels by MIME family:

```ts
const mediaLabel = (mime: string) => {
  if (mime.startsWith("audio/")) return "Audio"
  if (mime.startsWith("video/")) return "Video"
  if (mime === "application/pdf") return "PDF"
  return "Image"
}
```

- [x] **Step 5: Add TUI test cases**

In `packages/opencode/test/cli/cmd/tui/prompt-part.test.ts`, add cases that parse or render audio/video file prompt parts using the existing test helper:

```ts
test("renders audio and video prompt parts with stable labels", () => {
  expect(promptPartLabel({ type: "file", mime: "audio/mpeg", filename: "sound.mp3" } as any)).toBe("Audio")
  expect(promptPartLabel({ type: "file", mime: "video/mp4", filename: "clip.mp4" } as any)).toBe("Video")
})
```

Use the actual helper names from the file and keep the expected labels exactly `Audio` and `Video`.

- [x] **Step 6: Run CLI/TUI tests and typecheck**

Run from `packages/opencode`:

```bash
bun test test/cli/run/file-attachment.test.ts
bun test test/cli/cmd/tui/prompt-part.test.ts
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 7: Commit**

```bash
git add packages/opencode/src/cli/cmd/run.ts packages/opencode/test/cli/run/file-attachment.test.ts packages/opencode/src/cli/cmd/tui packages/opencode/test/cli/cmd/tui/prompt-part.test.ts
git commit -m "feat: accept audio and video in cli and tui"
```

### Task 6: Shared App Media UI

**Files:**
- Modify: `packages/app/src/constants/file-picker.ts`
- Modify: `packages/app/src/components/prompt-input/files.ts`
- Modify: `packages/app/src/context/prompt.tsx`
- Modify: `packages/app/src/components/prompt-input/attachments.ts`
- Create: `packages/app/src/components/prompt-input/media-attachments.tsx`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input/build-request-parts.ts`
- Modify: app prompt-input tests

- [x] **Step 1: Update app MIME tests first**

In `packages/app/src/components/prompt-input/attachments.test.ts`, extend `attachmentMime` tests:

```ts
test("keeps audio and video browser MIME types", async () => {
  expect(await attachmentMime(new File(["id3"], "voice.mp3", { type: "audio/mpeg" }))).toBe("audio/mpeg")
  expect(await attachmentMime(new File(["mp4"], "clip.mp4", { type: "video/mp4" }))).toBe("video/mp4")
})

test("detects audio and video from common extensions when browser MIME is missing", async () => {
  expect(await attachmentMime(new File(["id3"], "voice.mp3", { type: "" }))).toBe("audio/mpeg")
  expect(await attachmentMime(new File(["mp4"], "clip.mp4", { type: "" }))).toBe("video/mp4")
})
```

- [x] **Step 2: Run app MIME tests and confirm failure**

Run from `packages/app`:

```bash
bun test --preload ./happydom.ts ./src/components/prompt-input/attachments.test.ts
```

Expected: FAIL because audio/video are not accepted.

- [x] **Step 3: Extend app file picker constants**

Update `packages/app/src/constants/file-picker.ts`:

```ts
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
export const ACCEPTED_AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/ogg"]
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"]

export const ACCEPTED_FILE_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  ...ACCEPTED_AUDIO_TYPES,
  ...ACCEPTED_VIDEO_TYPES,
  "application/pdf",
  "text/*",
  // keep the existing structured text and extension entries unchanged
]
```

Add `MIME_EXT` entries:

```ts
["audio/mpeg", "mp3"],
["audio/mp4", "m4a"],
["audio/wav", "wav"],
["audio/webm", "webm"],
["audio/ogg", "ogg"],
["video/mp4", "mp4"],
["video/webm", "webm"],
["video/quicktime", "mov"],
["video/x-msvideo", "avi"],
```

- [x] **Step 4: Extend app attachment MIME detection**

Update imports in `packages/app/src/components/prompt-input/files.ts`:

```ts
import { ACCEPTED_AUDIO_TYPES, ACCEPTED_FILE_TYPES, ACCEPTED_IMAGE_TYPES, ACCEPTED_VIDEO_TYPES } from "@/constants/file-picker"
```

Add sets and extension map entries:

```ts
const AUDIO_MIMES = new Set(ACCEPTED_AUDIO_TYPES)
const VIDEO_MIMES = new Set(ACCEPTED_VIDEO_TYPES)
const AUDIO_EXTS = new Map([
  ["m4a", "audio/mp4"],
  ["mp3", "audio/mpeg"],
  ["ogg", "audio/ogg"],
  ["wav", "audio/wav"],
  ["webm", "audio/webm"],
])
const VIDEO_EXTS = new Map([
  ["avi", "video/x-msvideo"],
  ["mov", "video/quicktime"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
])
```

In `attachmentMime`, after PDF handling:

```ts
if (AUDIO_MIMES.has(type)) return type
if (VIDEO_MIMES.has(type)) return type
```

Replace fallback with:

```ts
const fallback =
  IMAGE_EXTS.get(suffix) ??
  AUDIO_EXTS.get(suffix) ??
  VIDEO_EXTS.get(suffix) ??
  (suffix === "pdf" ? "application/pdf" : undefined)
```

- [x] **Step 5: Rename app prompt image attachment type to media**

In `packages/app/src/context/prompt.tsx`, replace `ImageAttachmentPart` with:

```ts
export interface MediaAttachmentPart {
  type: "media"
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | MediaAttachmentPart
```

Update `isPartEqual` and `clonePart` cases from `"image"` to `"media"`.

- [x] **Step 6: Update attachment creation**

In `packages/app/src/components/prompt-input/attachments.ts`, change the import and object type:

```ts
import { usePrompt, type ContentPart, type MediaAttachmentPart } from "@/context/prompt"
```

Replace the created attachment:

```ts
const attachment: MediaAttachmentPart = {
  type: "media",
  id: uuid(),
  filename: file.name,
  mime,
  dataUrl: url,
}
```

Update removal:

```ts
const next = current.filter((part) => part.type !== "media" || part.id !== id)
```

Update `setDraggingType` type in this file and `prompt-input.tsx` from `"image"` to `"media"`.

- [x] **Step 7: Replace image strip with media strip**

Create `packages/app/src/components/prompt-input/media-attachments.tsx`:

```tsx
import { Component, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { MediaAttachmentPart } from "@/context/prompt"

type PromptMediaAttachmentsProps = {
  attachments: MediaAttachmentPart[]
  onOpen: (attachment: MediaAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

const fallbackClass = "size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base"
const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

function icon(mime: string) {
  if (mime.startsWith("audio/")) return "volume"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "file-text"
  return "folder"
}

export const PromptMediaAttachments: Component<PromptMediaAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <For each={props.attachments}>
          {(attachment) => (
            <Tooltip value={attachment.filename} placement="top" contentClass="break-all">
              <div class="relative group">
                <Show
                  when={attachment.mime.startsWith("image/")}
                  fallback={
                    <div class={fallbackClass}>
                      <Icon name={icon(attachment.mime)} class="size-6 text-text-weak" />
                    </div>
                  }
                >
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.filename}
                    class={imageClass}
                    onClick={() => props.onOpen(attachment)}
                  />
                </Show>
                <button
                  type="button"
                  onClick={() => props.onRemove(attachment.id)}
                  class={removeClass}
                  aria-label={props.removeLabel}
                >
                  <Icon name="close" class="size-3 text-text-weak" />
                </button>
                <div class={nameClass}>
                  <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                </div>
              </div>
            </Tooltip>
          )}
        </For>
      </div>
    </Show>
  )
}
```

If `volume`, `video`, or `file-text` are not valid icon names in `@opencode-ai/ui/icon`, run:

```bash
rg -n "\"volume\"|\"video\"|\"file-text\"|type IconName|const icons" packages/ui packages/app
```

Then use existing equivalent names from the icon registry.

- [x] **Step 8: Wire prompt input and request parts**

In `packages/app/src/components/prompt-input.tsx`, replace `PromptImageAttachments` imports/usages with `PromptMediaAttachments`, and replace:

```ts
const imageAttachments = createMemo(() =>
  prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
)
```

with:

```ts
const mediaAttachments = createMemo(() =>
  prompt.current().filter((part): part is MediaAttachmentPart => part.type === "media"),
)
```

Update blank checks to use `mediaAttachments().length`.

In `packages/app/src/components/prompt-input/build-request-parts.ts`, rename the input from `images` to `media`, accept `MediaAttachmentPart[]`, and build:

```ts
const media = input.media.map((attachment) => {
  return {
    id: Identifier.ascending("part"),
    type: "file",
    mime: attachment.mime,
    url: attachment.dataUrl,
    filename: attachment.filename,
  } satisfies PromptRequestPart
})

requestParts.push(...files, ...context, ...agents, ...media)
```

- [x] **Step 9: Update app tests**

In `packages/app/src/components/prompt-input/build-request-parts.test.ts`, update image fixture keys from `images` to `media` and attachment types from `"image"` to `"media"`. Add:

```ts
test("keeps audio and video uploaded attachments in order", () => {
  const result = buildRequestParts({
    prompt: [{ type: "text", content: "check media", start: 0, end: 11 }],
    context: [],
    media: [
      { type: "media", id: "media_1", filename: "a.mp3", mime: "audio/mpeg", dataUrl: "data:audio/mpeg;base64,AAA" },
      { type: "media", id: "media_2", filename: "b.mp4", mime: "video/mp4", dataUrl: "data:video/mp4;base64,BBB" },
    ],
    text: "check media",
    messageID: "msg_media",
    sessionID: "ses_media",
    sessionDirectory: "/repo",
  })

  const files = result.requestParts.filter((part) => part.type === "file" && part.url.startsWith("data:"))

  expect(files).toHaveLength(2)
  expect(files.map((part) => (part.type === "file" ? part.mime : ""))).toEqual(["audio/mpeg", "video/mp4"])
})
```

- [x] **Step 10: Run app tests and typecheck**

Run from `packages/app`:

```bash
bun test --preload ./happydom.ts ./src/components/prompt-input/attachments.test.ts
bun test --preload ./happydom.ts ./src/components/prompt-input/build-request-parts.test.ts
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 11: Commit**

```bash
git add packages/app/src/constants/file-picker.ts packages/app/src/components/prompt-input/files.ts packages/app/src/context/prompt.tsx packages/app/src/components/prompt-input/attachments.ts packages/app/src/components/prompt-input/media-attachments.tsx packages/app/src/components/prompt-input.tsx packages/app/src/components/prompt-input/build-request-parts.ts packages/app/src/components/prompt-input/*.test.ts
git commit -m "feat: add shared app media attachments"
```

### Task 7: SDK Regeneration And HTTP API Schema

#### Status: Completed

SDK regeneration completed with no generated diff. While verifying the full SDK HTTP API suite, the instance SSE route exposed a lazy stream context bug; fixed in `packages/opencode/src/server/routes/instance/httpapi/event.ts` by preserving `InstanceRef`/`WorkspaceRef` across stream pulls.

**Files:**
- Modify generated SDK files under `packages/sdk/js`
- Verify OpenAPI schema emitted by `packages/opencode`

- [x] **Step 1: Generate SDK after schema changes**

Run from repo root:

```bash
./packages/sdk/js/script/build.ts
```

Expected: generated SDK files update without errors.

- [x] **Step 2: Typecheck SDK**

Run from `packages/sdk/js`:

```bash
bun typecheck
```

Expected: PASS.

- [x] **Step 3: Verify prompt file part schema still accepts media MIME strings**

Run from `packages/opencode`:

```bash
bun test test/server/httpapi-session.test.ts
bun test test/server/httpapi-sdk.test.ts
bun typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add packages/sdk/js packages/opencode
git commit -m "chore: regenerate sdk for multimodal prompt schema"
```

### Task 8: Protected Live Experiment Harness

#### Status: Completed

Added a guarded multimodal live experiment entrypoint and redaction tests. The harness reports readiness by default and does not run provider calls unless explicitly enabled by environment at the future live-experiment step.

**Files:**
- Create: `packages/opencode/script/multimodal-live.ts`
- Create: `packages/opencode/test/provider/multimodal-live-redaction.test.ts`

- [x] **Step 1: Write redaction tests**

Create `packages/opencode/test/provider/multimodal-live-redaction.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { redactLiveExperimentOutput } from "../../script/multimodal-live"

describe("multimodal live experiment redaction", () => {
  test("redacts credentials, file URIs, and media payloads", () => {
    const output = redactLiveExperimentOutput({
      headers: { Authorization: "Bearer secret", "x-goog-api-key": "key" },
      body: {
        fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
        inlineData: { mimeType: "video/mp4", data: "AAAA" },
      },
    })

    expect(JSON.stringify(output)).not.toContain("secret")
    expect(JSON.stringify(output)).not.toContain("key")
    expect(JSON.stringify(output)).not.toContain("AAAA")
    expect(JSON.stringify(output)).toContain("[REDACTED]")
  })
})
```

- [x] **Step 2: Implement harness redaction and CLI guard**

Create `packages/opencode/script/multimodal-live.ts`:

```ts
export function redactLiveExperimentOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLiveExperimentOutput)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const lower = key.toLowerCase()
      if (lower === "authorization" || lower === "x-goog-api-key" || lower.includes("token") || lower.includes("key")) {
        return [key, "[REDACTED]"]
      }
      if (lower === "data" || lower === "inlineData".toLowerCase() || lower === "fileuri") return [key, "[REDACTED]"]
      return [key, redactLiveExperimentOutput(item)]
    }),
  )
}

if (import.meta.main) {
  const args = new Set(Bun.argv.slice(2))
  if (!args.has("--i-understand-this-uses-real-provider-quota")) {
    console.error("Refusing to run live multimodal experiments without explicit quota/secret acknowledgement.")
    process.exit(1)
  }

  console.log(
    JSON.stringify(
      redactLiveExperimentOutput({
        status: "ready",
        message: "Add provider-specific live calls behind this guarded entrypoint during implementation review.",
      }),
      null,
      2,
    ),
  )
}
```

- [x] **Step 3: Run redaction test**

Run from `packages/opencode`:

```bash
bun test test/provider/multimodal-live-redaction.test.ts
```

Expected: PASS.

- [x] **Step 4: Document credential gate in the harness**

Add this comment above `if (import.meta.main)`:

```ts
// Live experiments must read credentials only from existing OpenCode auth/env paths.
// Never write secrets, raw request bodies, raw responses, media bytes, or upload URIs to repo files.
```

- [x] **Step 5: Commit**

```bash
git add packages/opencode/script/multimodal-live.ts packages/opencode/test/provider/multimodal-live-redaction.test.ts
git commit -m "test: add protected multimodal live harness"
```

### Task 9: End-To-End Verification

#### Status: In progress

Automated package verification passed for OpenCode focused tests, SDK typecheck, app focused tests, and app typecheck. A Windows checkout/typecheck issue in the app custom-elements shim plus stale `image` preview checks were fixed and committed. Browser smoke on Windows reached the shared web app, opened the implementation worktree, and verified prompt-composer audio and video attachment rendering through the app paste path. Provider-backed Gemini testing was explicitly approved on 2026-05-13 and produced one successful real video+audio response, plus a provider-load retry condition for audio-only OpenCode runs. A follow-up provider seam pass added Gemini Files request-shape tests proving AI SDK serializes staged Gemini Files URLs and YouTube URLs as `fileData.fileUri`, hardened Files polling to require `ACTIVE`, and added a shared app/server upload store so browser and desktop file selections send a server-local `file://` part instead of large data URLs. Final review fixes now cover media restore/resubmit, Google URL scheme overclaiming, portable hook paths, upload limits, upload error handling, and preview URL cleanup.

**Files:**
- No new files unless a previous task requires a focused test adjustment.

- [x] **Step 1: Run package-level OpenCode tests**

Run from `packages/opencode`:

```bash
bun test test/util/media.test.ts test/config/attachment.test.ts test/tool/read.test.ts test/session/message-v2.test.ts test/provider/media-strategy.test.ts test/provider/transform.test.ts test/cli/run/file-attachment.test.ts test/cli/cmd/tui/prompt-part.test.ts
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 2: Run package-level app tests**

Run from `packages/app`:

```bash
bun test --preload ./happydom.ts ./src/components/prompt-input/attachments.test.ts ./src/components/prompt-input/build-request-parts.test.ts ./src/context/prompt.test.ts
bun typecheck
```

Expected: PASS and typecheck exits 0.

- [x] **Step 3: Run SDK typecheck**

Run from `packages/sdk/js`:

```bash
bun typecheck
```

Expected: PASS.

- [x] **Step 4: Manual Windows smoke test for app entry modes**

Start backend from `packages/opencode`:

```bash
bun run --conditions=browser ./src/index.ts serve --port 4096
```

Start app from `packages/app` in a separate terminal:

```bash
bun dev -- --port 4444
```

Open `http://localhost:4444`, attach one small `.mp3` and one small `.mp4` through the prompt UI, and verify the optimistic message contains file parts with `audio/` and `video/` MIME types. Stop both foreground processes after verification.

2026-05-13 Windows browser smoke result: started the backend on `127.0.0.1:4101` and the app on `127.0.0.1:4447` with inherited `OPENCODE_SERVER_PASSWORD` cleared for the local-only smoke. Opened the `multimodal-input` worktree in the Codex in-app Browser. Verified the shared web composer accepts an existing repo audio fixture via paste and renders an `Audio` attachment tile. Verified a small in-memory `video/mp4` clipboard payload renders a `Video` attachment tile. Did not press Send because the selected provider/model path would consume real OpenCode Go/provider usage and belongs in the protected live experiment gate.

2026-05-13 protected Gemini live result after user approval: aliased `GOOGLE_GENERATIVE_AI_API_KEY` from the existing `GEMINI_API_KEY` only in the local test process because `@ai-sdk/google` reads `GOOGLE_GENERATIVE_AI_API_KEY`. A 30s clip from the real Teams MP4 was sent through `opencode run --attach` with `google/gemini-3.1-flash-lite`; the recorded user part was `video/mp4`, and Gemini correctly described a meeting screen with speech audio. The full 69MB meeting MP4 remains the primary protected Gemini Files API staging test: it should upload through Files API and then reach AI SDK as a URL-backed file part instead of base64 inline media. The user-supplied `.mp3` file was actually AAC-in-MP4/M4A; this exposed a sniffing bug where OpenCode classified generic `ftyp` audio as `video/mp4`. That fix is committed as `fix: preserve audio mp4 attachment mime` and covers audio fallbacks such as mislabeled `.mp3` files whose bytes are MP4-family audio. Audio-only OpenCode CLI runs with tiny WAV/MP3 reached Google retry status (`model is currently experiencing high demand`) instead of completion; direct AI SDK `fullStream` with the same tiny WAV succeeded once, so this is currently recorded as provider-load/runtime retry evidence, not a deterministic OpenCode media-conversion failure.

- [x] **Step 5: Manual CLI smoke test**

From `packages/opencode`, run against a non-secret local model configuration or a dry session where network calls are blocked:

```bash
bun run --conditions=browser ./src/index.ts run "describe attached media" --file ..\..\docs\superpowers\specs\2026-05-11-opencode-multimodal-design.md --format json
```

Expected: text file path behavior remains intact. For audio/video, run only with a configured provider that supports the selected MIME and confirm the file part MIME is not `text/plain`.

2026-05-13 CLI smoke result: using the existing `GEMINI_API_KEY` mapped to `GOOGLE_GENERATIVE_AI_API_KEY` only for the local process, `opencode run --model google/gemini-3.1-flash-lite --file ..\..\.tmp-browser-smoke-logs\ui-smoke-clip.mp4 --format json "In one sentence, describe the attached video."` exited 0 and Gemini correctly described the attached Microsoft Teams meeting video. A mock Gemini browser smoke also captured `POST /upload/v1beta/files` followed by `streamGenerateContent` with `fileData.fileUri` and no `inlineData`.

2026-05-13 upload-store seam result: added `/file/upload` as an authenticated workspace-routed raw route that stores browser/desktop media in the OpenCode data directory and returns a `FilePartInput` with a `file://` URL. Updated the shared app prompt path to upload selected media before adding the attachment tile, retain object URLs only for UI preview, and submit the returned server-local file URL through normal and slash-command sends. Focused app tests, focused provider tests, server upload tests, and package typechecks passed. Browser smoke on `127.0.0.1:4448` against backend `127.0.0.1:4104` pasted `ui-smoke-clip.mp4` into the shared prompt composer, rendered a `video/mp4` tile, and created `C:\Users\feket\.local\share\opencode\uploads\...\-clipboard.mp4`, proving the UI used the server upload store before prompt submission.

2026-05-15 follow-up: Chrome automation was connected through the trusted bundled `@chrome` marketplace path and opened the feature worktree UI at `127.0.0.1:4451`. A subagent audit found that app-side MIME sniffing was not forwarded to `/file/upload`, so browser/desktop files with generic `File.type` could be accepted by the composer and rejected by the server. Fixed the shared app SDK upload path to send the normalized MIME through `content-type` and `x-opencode-mime`, with app and server regression tests. The same audit found that provider media strategy tests were not enforced during final provider message transformation for non-Google URL transports. Fixed `ProviderTransform.message` to apply `ProviderMediaStrategy` rejection after modality checks and pass the resolved provider info from `session/llm`, with tests for non-Google YouTube rejection, visual-only audio rejection, and Gemini YouTube passthrough. Verification passed from package directories: focused app attachment tests, focused server upload test, focused provider transform tests, `packages/app` typecheck, and `packages/opencode` typecheck. Real Chrome file upload smoke is currently blocked by the Codex Chrome extension file-access permission; enable "Allow access to file URLs" for the extension before rerunning file chooser upload tests.

- [x] **Step 6: Commit verification fixes**

If verification required changes:

```bash
git add <changed-files>
git commit -m "fix: stabilize multimodal verification"
```

If no changes were needed, do not create an empty commit.

### Task 10: Surface Parity, PR Hygiene, And Merge Readiness

#### Status: Not started

This task tracks the remaining work discovered during the post-implementation surface review. The branch has broad implementation coverage, but it is not ready to merge until these checks are complete or explicitly scoped out in the PR description.

**Files:**
- Update: `docs/superpowers/specs/2026-05-11-opencode-multimodal-design.md`
- Update: `docs/superpowers/plans/2026-05-12-opencode-multimodal-implementation.md`
- Potentially modify implementation files only after a reviewed follow-up design decision.

- [x] **Step 1: Document current surface status and gaps**

Record the implemented, partially covered, and unproven surfaces in the design spec so merge discussion can reference a stable checklist instead of chat memory.

2026-05-15 result: added `Current Implementation Status` to the design spec with implemented coverage, remaining gaps, and merge readiness criteria.

- [x] **Step 2: Clean PR history against upstream**

Refresh from `upstream/dev` and rebuild the PR so it contains only multimodal implementation commits, not upstream catch-up commits.

Required checks:

```bash
git fetch upstream dev
git log --oneline --left-right upstream/dev...HEAD
git diff --stat upstream/dev...HEAD
```

Expected: upstream-only commits are not present in the PR side, and the changed files match the multimodal feature scope plus project-local docs/config that the user approved.

2026-05-15 result: fetched `upstream/dev` at `f80715272`, rebased the feature branch onto it, resolved current upstream conflicts, and dropped obsolete commit `36f935cad` because upstream's new event handler now preserves request context with `Effect.context()` and `Stream.provideContext(context)`. `git rev-list --left-right --count upstream/dev...HEAD` now reports `0 17`, and `git log --left-right --cherry-pick upstream/dev...HEAD --right-only` shows only multimodal/docs commits.

- [ ] **Step 3: Verify shared web UI in Chrome**

Use the real Chrome automation surface, not only the in-app browser, to upload a real MP4 through the UI and send a Gemini API-key prompt.

Evidence to capture:

- The attachment chip is visible before send.
- The sent timeline message still shows the media attachment.
- The upload exists in the OpenCode user data upload store.
- Gemini Files cache/request-shape evidence shows the model request used a Files API URI, not inline base64, for the local MP4.

- [ ] **Step 4: Verify desktop sidecar or document desktop scope**

Run a packaged or dev desktop smoke against the local sidecar when feasible. If not feasible in this branch, explicitly document desktop as shared-app covered but not packaged-E2E verified.

Required coverage:

- Native file picker can select audio/video media.
- Sidecar credentials allow `/file/upload`.
- Windows WSL path conversion behavior remains unchanged for file-path references.
- Remote-server desktop mode uses upload rather than a local path shortcut.

- [ ] **Step 5: Verify CLI and TUI live media paths**

Run at least one CLI or TUI local media smoke with a real provider, plus a no-provider dry path where practical.

Minimum evidence:

- `opencode run --file <mp4-or-mp3>` sends the detected media MIME, not `text/plain`.
- TUI path-paste renders the correct `Audio` or `Video` label.
- Oversized inline-only media produces a clear error instead of silent omission.

- [ ] **Step 6: Verify provider matrix claims**

Run or explicitly defer protected live tests for:

- Gemini API-key: MP4 through Files API, oversized local MP4 through Files API, MP3 through Files API or inline as strategy decides, YouTube URL.
- Gemini OAuth / Antigravity custom Google: inline small MP4/MP3 and explicit limit behavior; no Files API claim unless proven.
- OpenCode Go: MiMo v2.5 audio/video, Kimi K2.6 visual video, Qwen Plus visual video if configured.

Do not request new credentials until the exact next experiment is ready. Use existing env/auth where available and redact all request/response artifacts.

- [x] **Step 7: Decide large-file UX**

Make one explicit design choice before adding more code:

- Reject oversized inline-only media with a clear error and let the agent/user split it manually.
- Add automatic chunking/transcoding as a separate feature.
- Add provider-specific chunking only for known OAuth/custom endpoints.

Current recommendation: reject oversized inline-only media for this PR, document the error path, and treat automatic chunking/transcoding as a follow-up design.

2026-05-15 result: confirmed this PR keeps the conservative behavior. Gemini API-key staging may use Gemini Files API for local/data media within OpenCode's upload route limits; inline-only transports reject oversized media before model calls; browser uploads reject files over the raw upload route limit with a structured 413 response. Automatic chunking/transcoding remains out of scope.

- [x] **Step 8: Run final verification**

Run from package directories only:

```bash
cd packages/opencode
bun test --timeout 30000 test/provider/media-staging.test.ts test/provider/media-strategy.test.ts test/server/httpapi-file.test.ts test/session/message-v2.test.ts test/tool/read.test.ts test/util/media.test.ts test/cli/run/file-attachment.test.ts test/cli/cmd/tui/prompt-part.test.ts
bun test --timeout 30000 test/session/prompt.test.ts -t "resolves audio file URLs|resolves video file URLs|keeps Google local video file URLs|resolves OAuth-style Google local video file URLs|allows large Google data video URLs|rejects oversized audio and video attachments"
bun typecheck

cd ../app
bun test src/components/prompt-input/attachments.test.ts src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/submit.test.ts src/utils/prompt.test.ts
bun typecheck

cd ../sdk/js
bun typecheck
```

Expected: all commands pass. If broad prompt lifecycle tests still require a longer timeout, record that separately and do not conflate it with media test failure.

2026-05-15 result after upstream rebase:

- `packages/opencode`: focused media/server/CLI/TUI suite passed with `--timeout 30000` (`125 pass, 0 fail`). The explicit timeout is required on Windows because the shared instance cleanup hook can exceed Bun's 5s default after raw HTTP API tests.
- `packages/opencode`: focused prompt media tests passed (`6 pass, 0 fail`).
- `packages/opencode`: `bun typecheck` passed.
- `packages/app`: prompt attachment/request tests passed (`26 pass, 0 fail`) and `bun typecheck` passed.
- `packages/ui`: `message-file` attachment rendering tests passed (`4 pass, 0 fail`) and `bun typecheck` passed.
- `packages/sdk/js`: `bun typecheck` passed.

- [ ] **Step 9: Run external review before readying PR**

Before marking the PR ready:

- Run a local code review with `claude -p` using Opus 4.7 / max reasoning if available.
- Spawn a clean-context GPT-5.5 extra-high subagent review using the Superpowers code-review skill.
- If feasible, request a GitHub Copilot PR review agent.

Each review prompt must include the design goal, implemented scope, known gaps, live-test evidence, and the explicit non-claims around OAuth/Antigravity/OpenCode Go until live tests pass.

## Self-Review Notes

Spec coverage:
- All entry modes are represented by core `FilePart`, CLI/TUI, SDK/HTTP, ACP/tool-result plumbing, and shared app UI tasks. Some surfaces remain API-compatible or code-path covered rather than live-E2E verified; see Task 10.
- Metadata-driven support is covered by `ProviderMediaStrategy.resolve`.
- MiMo V2.5 is treated as a live-test candidate, not a hard-coded implementation.
- Kimi/Qwen visual-only video is represented by `videoAudio: "visual-only"`.
- Secret-backed live experiments are guarded and redacted.

Placeholder scan:
- No task uses forbidden placeholder markers or an undefined implementation step.

Type consistency:
- App prompt media type is named `MediaAttachmentPart` with `type: "media"`.
- Core transport strategy namespace is `ProviderMediaStrategy`.
- Audio/video use existing `FilePart` storage and AI SDK `type: "file"` conversion.
