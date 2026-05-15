import type { Provider } from "@/provider/provider"

export type Modality = "audio" | "image" | "pdf" | "text" | "video"
export type Scheme = "data" | "file" | "http" | "https" | "gemini-file" | "gs" | "youtube"
export type VideoAudio = "preserved" | "visual-only" | "reject-if-audio" | "unknown"
export type Transport = { type: "inline" } | { type: "gemini-files" } | { type: "url" } | { type: "reject"; reason: string }
export type Strategy = {
  accepted: ReadonlySet<Modality>
  schemes: ReadonlySet<Scheme>
  videoAudio: VideoAudio
  transport: (input: { mime: string; url: string }) => Transport
}

function customGoogleTransport(provider?: Provider.Info) {
  return provider?.options.apiKey === "" || typeof provider?.options.fetch === "function"
}

function modality(mime: string): Modality | undefined {
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/pdf") return "pdf"
  if (mime.startsWith("text/")) return "text"
  if (mime.startsWith("video/")) return "video"
  return undefined
}

function scheme(url: string): Scheme | undefined {
  const lower = url.toLowerCase()
  if (lower.startsWith("https://www.youtube.com/") || lower.startsWith("https://youtube.com/") || lower.startsWith("https://youtu.be/"))
    return "youtube"
  if (lower.startsWith("data:")) return "data"
  if (lower.startsWith("file:")) return "file"
  if (lower.startsWith("gemini-file:")) return "gemini-file"
  if (lower.startsWith("gs://")) return "gs"
  if (lower.startsWith("http://")) return "http"
  if (lower.startsWith("https://")) return "https"
  if (!url.includes(":")) return "file"
  return undefined
}

export function openAICompatibleVideoURL(model: Provider.Model) {
  return (
    model.providerID === "opencode-go" &&
    model.api.npm === "@ai-sdk/openai-compatible" &&
    model.api.id === "mimo-v2.5"
  )
}

export function resolve(model: Provider.Model, provider?: Provider.Info): Strategy {
  const customGoogle = model.api.npm === "@ai-sdk/google" && customGoogleTransport(provider)
  const input = model.capabilities.input ?? {}
  const accepted = new Set((["audio", "image", "pdf", "text", "video"] as const).filter((item) => input[item]))
  const schemes = new Set<Scheme>(
    customGoogle
      ? ["data", "file"]
      : model.api.npm === "@ai-sdk/google"
      ? ["data", "file", "https", "youtube"]
      : ["data", "file", "http", "https"],
  )
  const videoAudio = input.video
    ? input.audio
      ? "preserved"
      : "visual-only"
    : "unknown"

  return {
    accepted,
    schemes,
    videoAudio,
    transport: (input) => {
      const inputModality = modality(input.mime)
      if (!inputModality) return { type: "reject", reason: `Unknown media MIME type: ${input.mime}` }
      if (!accepted.has(inputModality)) return { type: "reject", reason: `Model does not accept ${inputModality} input` }

      const inputScheme = scheme(input.url)
      if (!inputScheme) return { type: "reject", reason: `Unsupported media URL scheme for ${input.url}` }
      if (customGoogle && !schemes.has(inputScheme))
        return { type: "reject", reason: "Custom Google transports only support inline file data" }
      if (!schemes.has(inputScheme)) return { type: "reject", reason: `Model does not support ${inputScheme} media URLs` }

      if (model.api.npm === "@ai-sdk/openai-compatible" && inputModality === "video" && !openAICompatibleVideoURL(model)) {
        return { type: "reject", reason: "@ai-sdk/openai-compatible does not support video file parts" }
      }

      if (
        model.api.npm === "@ai-sdk/google" &&
        !customGoogle &&
        (inputScheme === "data" || inputScheme === "file") &&
        (inputModality === "audio" || inputModality === "video" || inputModality === "pdf")
      ) {
        return { type: "gemini-files" }
      }
      if (inputScheme === "data" || inputScheme === "file") return { type: "inline" }
      return { type: "url" }
    },
  }
}

export * as ProviderMediaStrategy from "./media-strategy"
