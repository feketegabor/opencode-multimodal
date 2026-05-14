import type { MessageV2 } from "@/session/message-v2"
import type { Provider } from "./provider"
import { ProviderMediaStrategy } from "./media-strategy"
import { Global } from "@opencode-ai/core/global"
import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

export type UploadInput = {
  apiKey: string
  baseURL: string
  mime: string
  url: string
  filename?: string
  sourcePath?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  cachePath?: string
}

export type UploadResult = {
  uri: string
  name?: string
  expiresAt?: number
}

type Options = {
  model: Provider.Model
  provider: Provider.Info
  messages: MessageV2.WithParts[]
  upload?: (input: UploadInput) => Promise<UploadResult>
  cachePath?: string
  inlineMaxBytes?: number
}

type GeminiFile = {
  name?: string
  uri?: string
  state?: string
  expirationTime?: string
}

const CUSTOM_GOOGLE_INLINE_MAX_BYTES = 50 * 1024 * 1024

function customGoogleTransport(provider: Provider.Info) {
  return provider.options.apiKey === ""
}

function apiKey(provider: Provider.Info) {
  if (typeof provider.options.apiKey === "string" && provider.options.apiKey !== "") return provider.options.apiKey
  if (provider.key) return provider.key
  return provider.env.map((key) => process.env[key]).find((value) => value)
}

function baseURL(input: { model: Provider.Model; provider: Provider.Info }) {
  if (typeof input.provider.options.baseURL === "string" && input.provider.options.baseURL !== "")
    return input.provider.options.baseURL
  return input.model.api.url || "https://generativelanguage.googleapis.com"
}

function customBaseURL(provider: Provider.Info) {
  if (typeof provider.options.baseURL === "string" && provider.options.baseURL !== "") return provider.options.baseURL
  return undefined
}

function apiRoot(baseURL: string) {
  return baseURL.replace(/\/+$/, "").replace(/\/v1beta$/, "")
}

function dataUrlBytes(url: string) {
  const commaIndex = url.indexOf(",")
  if (commaIndex === -1) throw new Error("Invalid Gemini Files data URL")
  const header = url.slice(0, commaIndex).toLowerCase()
  const data = url.slice(commaIndex + 1)
  return Uint8Array.from(Buffer.from(data, header.includes(";base64") ? "base64" : "utf8"))
}

async function mediaBytes(input: UploadInput) {
  if (input.sourcePath) {
    const file = Bun.file(input.sourcePath)
    return { bytes: await file.bytes(), size: file.size }
  }
  const bytes = dataUrlBytes(input.url)
  return { bytes, size: bytes.byteLength }
}

async function mediaBody(input: UploadInput) {
  if (input.sourcePath) {
    const file = Bun.file(input.sourcePath)
    return { body: file, size: file.size }
  }
  const media = await mediaBytes(input)
  return { body: media.bytes, size: media.size }
}

function cachePath(input: UploadInput) {
  return input.cachePath ?? path.join(Global.Path.cache, "gemini-files.json")
}

async function cacheKey(input: UploadInput) {
  const media = await mediaBytes(input)
  return [
    apiRoot(input.baseURL),
    input.mime,
    media.size,
    createHash("sha256").update(media.bytes).digest("hex"),
  ].join(":")
}

async function readCache(filepath: string) {
  try {
    return (await Bun.file(filepath).json()) as Record<string, UploadResult>
  } catch {
    return {}
  }
}

async function cached(input: UploadInput, uploader: (input: UploadInput) => Promise<UploadResult>) {
  const filepath = cachePath(input)
  const key = await cacheKey(input)
  const existing = (await readCache(filepath))[key]
  if (existing?.expiresAt && existing.expiresAt > Date.now() + 60_000) return existing

  const uploaded = await uploader(input)
  if (!uploaded.expiresAt) return uploaded
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await Bun.write(
    filepath,
    JSON.stringify(
      {
        ...(await readCache(filepath)),
        [key]: uploaded,
      },
      null,
      2,
    ),
  )
  return uploaded
}

function responseFile(body: unknown): GeminiFile {
  const file = typeof body === "object" && body && "file" in body ? (body.file as GeminiFile) : (body as GeminiFile)
  if (!file.uri) throw new Error("Gemini Files upload response did not include a file URI")
  return file
}

function aiSDKFileURI(input: { provider: Provider.Info; upload: UploadResult }) {
  const base = customBaseURL(input.provider)
  if (!base || !input.upload.name?.startsWith("files/")) return input.upload.uri
  return `${base.replace(/\/+$/, "")}/${input.upload.name}`
}

async function json(response: Response) {
  if (response.ok) return response.json()
  throw new Error(`Gemini Files request failed with HTTP ${response.status}`)
}

async function waitForActive(input: UploadInput, file: GeminiFile) {
  if (!file.name) throw new Error("Gemini Files upload response did not include a file name")
  if (file.state === "ACTIVE") return file
  if (file.state !== "PROCESSING")
    throw new Error(`Gemini Files upload ended in ${file.state ?? "missing"} state: ${file.name}`)
  const fetcher = input.fetch ?? fetch
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  for (const _ of Array.from({ length: 120 })) {
    await sleep(5_000)
    const latest = responseFile(
        await json(
        await fetcher(`${apiRoot(input.baseURL)}/v1beta/${file.name}`, {
          headers: { "x-goog-api-key": input.apiKey },
        }),
      ),
    )
    if (!latest.name) throw new Error("Gemini Files status response did not include a file name")
    if (latest.state === "ACTIVE") return latest
    if (latest.state !== "PROCESSING")
      throw new Error(`Gemini Files upload ended in ${latest.state ?? "missing"} state: ${latest.name}`)
  }

  throw new Error(`Gemini Files upload did not become ACTIVE: ${file.name}`)
}

function sourcePath(part: MessageV2.FilePart) {
  if (part.source?.type === "file") return part.source.path
  if (part.url.startsWith("file:")) return fileURLToPath(part.url)
  return undefined
}

function shouldStage(input: { model: Provider.Model; provider: Provider.Info; part: MessageV2.FilePart }) {
  const strategy = ProviderMediaStrategy.resolve(input.model, input.provider)
  const transport = strategy.transport({ mime: input.part.mime, url: input.part.url })
  return transport.type === "gemini-files"
}

async function inlineFilePart(input: Options, part: MessageV2.FilePart) {
  const max = input.inlineMaxBytes ?? CUSTOM_GOOGLE_INLINE_MAX_BYTES
  const source = sourcePath(part)
  if (source) {
    const file = Bun.file(source)
    const bytes = await file.bytes()
    if (file.size > max)
      throw new Error(`Attachment ${part.filename ?? "attachment"} (${part.mime}) exceeds inline media limit ${max} bytes`)
    return { ...part, url: `data:${part.mime};base64,${Buffer.from(bytes).toString("base64")}` }
  }
  const bytes = dataUrlBytes(part.url)
  const media = { bytes, size: bytes.byteLength }
  if (media.size > max)
    throw new Error(`Attachment ${part.filename ?? "attachment"} (${part.mime}) exceeds inline media limit ${max} bytes`)
  return { ...part, url: `data:${part.mime};base64,${Buffer.from(media.bytes).toString("base64")}` }
}

async function stageFilePart(input: Options, part: MessageV2.FilePart) {
  if (input.model.api.npm !== "@ai-sdk/google") return part
  const strategy = ProviderMediaStrategy.resolve(input.model, input.provider)
  const transport = strategy.transport({ mime: part.mime, url: part.url })
  if (customGoogleTransport(input.provider) && transport.type === "inline") return inlineFilePart(input, part)
  if (!shouldStage({ model: input.model, provider: input.provider, part })) return part
  const key = apiKey(input.provider)
  if (!key) throw new Error("Gemini Files staging requires a Google API key")
  const uploadInput = {
    apiKey: key,
    baseURL: baseURL(input),
    mime: part.mime,
    url: part.url,
    filename: part.filename,
    sourcePath: sourcePath(part),
    cachePath: input.cachePath,
  }
  const uploader = input.upload ?? upload
  const uploaded = input.upload && !input.cachePath ? await uploader(uploadInput) : await cached(uploadInput, uploader)
  return { ...part, url: aiSDKFileURI({ provider: input.provider, upload: uploaded }) }
}

export async function upload(input: UploadInput): Promise<UploadResult> {
  const fetcher = input.fetch ?? fetch
  const media = await mediaBody(input)
  const start = await fetcher(`${apiRoot(input.baseURL)}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(media.size),
      "X-Goog-Upload-Header-Content-Type": input.mime,
      "x-goog-api-key": input.apiKey,
    },
    body: JSON.stringify({ file: { display_name: input.filename ?? "attachment" } }),
  })
  if (!start.ok) throw new Error(`Gemini Files upload start failed with HTTP ${start.status}`)
  const uploadURL = start.headers.get("x-goog-upload-url")
  if (!uploadURL) throw new Error("Gemini Files upload start response did not include an upload URL")

  const created = responseFile(
    await json(
      await fetcher(uploadURL, {
        method: "POST",
        headers: {
          "Content-Length": String(media.size),
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize",
        },
        body: media.body,
      }),
    ),
  )
  const active = await waitForActive(input, created)
  return {
    uri: active.uri!,
    name: active.name,
    expiresAt: active.expirationTime ? new Date(active.expirationTime).getTime() : undefined,
  }
}

export async function stageMessages(input: Options) {
  if (input.model.api.npm !== "@ai-sdk/google") return input.messages

  let changed = false
  const messages = await Promise.all(
    input.messages.map(async (message) => {
      const parts = await Promise.all(
        message.parts.map(async (part) => {
          if (part.type !== "file") return part
          const staged = await stageFilePart(input, part)
          if (staged !== part) changed = true
          return staged
        }),
      )
      return parts === message.parts ? message : { ...message, parts }
    }),
  )

  return changed ? messages : input.messages
}

export * as GeminiMediaStaging from "./media-staging"
