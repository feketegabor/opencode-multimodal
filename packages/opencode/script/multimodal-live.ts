const secretKeys = new Set([
  "authorization",
  "x-goog-api-key",
  "api-key",
  "apikey",
  "password",
  "secret",
  "token",
  "cookie",
  "credential",
])

const uriKeys = new Set(["fileuri", "file_uri", "uri", "url", "uploaduri", "upload_uri"])
const mediaPayloadKeys = new Set(["data", "bytes", "base64"])

function isSecretKey(key: string) {
  return secretKeys.has(key) || key.includes("token") || key.includes("secret") || key.includes("key")
}

function isProtectedUri(value: string) {
  return (
    value.startsWith("file://") ||
    value.startsWith("gs://") ||
    value.startsWith("data:") ||
    value.includes("generativelanguage.googleapis.com")
  )
}

export function redactLiveExperimentOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLiveExperimentOutput)
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && isProtectedUri(value)) return "[REDACTED]"
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const lower = key.toLowerCase()
      if (isSecretKey(lower)) return [key, "[REDACTED]"]
      if (typeof item === "string" && (uriKeys.has(lower) || isProtectedUri(item))) return [key, "[REDACTED]"]
      if (typeof item === "string" && mediaPayloadKeys.has(lower)) return [key, "[REDACTED_MEDIA_PAYLOAD]"]
      return [key, redactLiveExperimentOutput(item)]
    }),
  )
}

// Live experiments must read credentials only from existing OpenCode auth/env paths.
// Never write secrets, raw request bodies, raw responses, media bytes, or upload URIs to repo files.
if (import.meta.main) {
  console.log(
    JSON.stringify(
      redactLiveExperimentOutput({
        status: "ready",
        message: "Set OPENCODE_MULTIMODAL_LIVE=1 only when intentionally running protected provider experiments.",
        enabled: process.env.OPENCODE_MULTIMODAL_LIVE === "1",
      }),
      null,
      2,
    ),
  )
}
