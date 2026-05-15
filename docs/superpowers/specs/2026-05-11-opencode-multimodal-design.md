# OpenCode Multimodal Input Design

Draft for approval.

## Goal

Add first-class audio and video inputs to OpenCode without collapsing provider-specific media behavior into one generic attachment path.

The implementation should let users attach media from every OpenCode entry mode where file input exists or can be added cleanly: TUI, CLI, SDK, HTTP API, ACP, tool results, configured references, `opencode serve`, desktop, and future clients built on the same prompt API. Unsupported media must fail clearly before or during prompt conversion, not disappear silently.

This spec is based on upstream `anomalyco/opencode` `upstream/dev` at `a5c35bf18` fetched on 2026-05-11.

## Current Upstream Architecture

OpenCode already has the core building blocks for multimodal input:

- `packages/opencode/src/session/message-v2.ts` stores user and tool files as `FilePart` with `mime`, `filename`, `url`, and optional `source`.
- `MessageV2.FilePartInput` is the public prompt input shape used by `SessionPrompt.PromptInput`, HTTP API payloads, the generated SDK, TUI prompt submission, and command execution.
- `SessionPrompt.resolveUserPart` reads `file:` URLs, expands text and directories through the read tool, and converts binary files to `data:${mime};base64,...` file parts before storage.
- `MessageV2.toModelMessagesEffect` converts stored parts into AI SDK `ModelMessage` values and already emits `type: "file"` model parts for non-text, non-directory files.
- `ProviderTransform.unsupportedParts` already maps file MIME types to model modalities and turns unsupported file parts into explicit user-visible model text.
- `Provider.Model.capabilities.input` already has booleans for `text`, `audio`, `image`, `video`, and `pdf`, populated from `models.dev` `modalities.input`.
- `packages/opencode/src/config/attachment.ts` currently exposes image-only attachment controls. There are no audio or video limits yet.
- `packages/opencode/src/util/media.ts` currently treats only images and PDFs as media. Audio and video are absent from helper predicates and MIME sniffing.
- TUI paste support currently accepts clipboard images and path-pasted images/PDFs. It does not accept path-pasted audio/video, and CLI `--file` currently forces file MIME to `text/plain`.
- Tool output media extraction is image/PDF-only because it depends on `isMedia`.
- `packages/app` is the shared Solid frontend used by the browser app and desktop renderer. It currently has image-only prompt attachments in `components/prompt-input/*`, including paste/drop handling, data URL conversion, attachment chips, and request-part building.
- `packages/desktop` wraps `@opencode-ai/app` in Electron, starts a local sidecar server, and supplies platform services such as native file pickers, WSL path conversion on Windows, and clipboard image IPC. This means web and desktop attachment UX should mostly be implemented in the shared app package, with desktop-only native bridges kept narrow.
- `packages/web` is the documentation site, not the runtime web app. Its plugin docs describe extensibility, but runtime multimodal UX belongs in `packages/app`.

The main design implication is that this is an extension of the existing file-part pipeline, not a new message-part family.

## Provider Facts

AI SDK v6 `ModelMessage` file parts use `type: "file"`, `data`, `mediaType`, and optional `filename`. The docs say file data can be base64, binary data, data URLs, HTTP(S) URLs, or URL objects, and that only some providers/models support file parts.

Gemini API supports audio and video via two native paths:

- Inline data in `generateContent`, with a current 100 MB total request limit; PDF inline/file request handling remains capped at 50 MB where documented.
- Files API uploads, then `file_data`/file URI references in `generateContent`.

Gemini video also supports direct YouTube URLs in preview. Official guidance says use the Files API when request size exceeds inline limits, and Files API is also preferable for local/reusable media because uploaded files can be referenced by URI instead of embedding base64 in every model request.

Current `models.dev` data already marks many Gemini and OpenCode Zen models with audio/video input modalities. The model catalog available to OpenCode is the first source of truth for broad capability discovery, but provider and model ID still matter.

Current `models.dev` data for `opencode-go` marks:

- `mimo-v2.5` as text, image, audio, and video input.
- `mimo-v2.5-pro` as text input only.
- `kimi-k2.5`, `kimi-k2.6`, `qwen3.5-plus`, and `qwen3.6-plus` as text, image, and video input, but not audio input.

The OpenCode Go docs list these same model IDs and document Kimi/MiMo through OpenAI-compatible chat completions and Qwen through Alibaba chat completions. Current `models.dev` metadata for `opencode-go/qwen3.x-plus` instead reports an Anthropic-compatible provider route. Treat that as a route discrepancy to verify against the upstream code and endpoint before implementation. OpenCode Go public `/models` currently returns model IDs without rich modality metadata, so Go media support still needs contract tests and protected live experiments before enabling claims for specific Go models.

Official Kimi docs describe Kimi K2.5 as text, image, and video input, with file upload recommended for large videos. Official Alibaba Cloud Model Studio docs describe `qwen3.6-plus` and `qwen3.5-plus` as text, image, and video input, while separately naming `qwen3.5-omni-*` as video models that also support audio input. The design therefore treats Kimi K2.5/K2.6 and Qwen Plus video as visual video unless a provider-specific live test proves that the audio track in a video is consumed.

Local reference repos under `opensrc/` show that Gemini CLI OAuth and Antigravity-style OAuth are request-rewriting providers over Google Code Assist / Cloud Code gateway APIs. They are not equivalent to the Gemini API-key path. Their request bodies use Gemini-style `contents[].parts[]`, but the local references do not demonstrate complete audio/video transport support. The design therefore treats them as separate provider strategies that initially support inline binary/data URLs only if live tests confirm acceptance.

## Design Principles

1. Preserve one canonical OpenCode attachment representation: stored `FilePart` with `mime`, `filename`, `url`, and `source`.
2. Model capabilities answer what a model can consume. Provider transport strategy answers how OpenCode should send it.
3. Keep provider media paths explicit: inline bytes, AI SDK file URL, Gemini Files API file URI, GCS URI, YouTube URL, and OAuth gateway inline upload are different transports.
4. Validate size and modality before expensive network work where possible.
5. Never persist provider secrets, OAuth tokens, media bytes, or upload URIs in committed files, generated docs, public logs, or CI output.
6. Make the same media pipeline work across all OpenCode entry modes. Mode-specific UI and platform bridges can add convenience, but they must all converge on the canonical prompt file-part API.

## Recommended Approach

Use a layered media pipeline:

1. Extend the existing file-part pipeline to recognize audio and video.
2. Add provider/media transport resolution immediately before calling the AI SDK.
3. Add provider-specific Gemini API upload support as an internal preflight for selected providers.
4. Keep OAuth gateway support behind explicit provider strategies and live verification.

This is better than either a minimal MIME-list patch or a new attachment subsystem. A MIME-list patch would send some audio/video through by accident but would not handle provider limits, Gemini Files API, or URL semantics. A new subsystem would duplicate storage, prompt, SDK, and transcript behavior that already exists for file parts.

## User-Facing Behavior

Users can attach supported media through:

- TUI paste of a local file path for image, PDF, audio, and video.
- TUI clipboard paste for images as today, with audio/video clipboard support only if the platform clipboard reader can provide MIME and bytes.
- CLI `opencode run --file <path>` using detected MIME instead of always `text/plain`.
- SDK/HTTP prompt `parts` using existing file parts with `file:`, `data:`, `http:`, `https:`, Gemini file URI, GCS URI, or YouTube URL as appropriate.
- Web app prompt attachments in `opencode serve`, using file picker, drag/drop, and paste from the browser.
- Desktop app prompt attachments using the same shared app attachment UI, plus native file picker and clipboard support where Electron exposes better platform capabilities.
- Tool results that return file attachments with audio/video MIME types.
- ACP content blocks where the ACP client provides file/resource/blob content.

All entry modes should converge on the same stored `FilePart` representation. A mode can have its own capture mechanism, such as native desktop clipboard, browser file picker, shell path paste, or SDK JSON payload, but it must not fork the downstream provider behavior.

The TUI should show compact badges for audio and video, similar to existing image/PDF badges. Prompt history and transcript rendering should keep media virtual labels stable, for example `[Audio 1]` and `[Video 1]`.

Unsupported media behavior:

- If the selected model lacks the modality, the model receives an explicit error text from `ProviderTransform.unsupportedParts`, matching current unsupported-image behavior.
- If the provider transport cannot send that modality, OpenCode should fail the prompt with a clear session error before streaming starts.
- If an upload fails, the error should name the file, provider, and strategy, without logging secrets or raw media.
- If a selected model supports video but not audio, and the user attaches a video file that may contain audio, the UI should warn that only the visual track is expected to be used. If OpenCode cannot safely send that container to the provider without implying audio support, the prompt should fail with a transport error instead of claiming full audio-video understanding.

## Entry Mode Coverage

Implement media support generally, then wire each entry mode into that same path:

- Core prompt API, SDK, HTTP API, and stored messages remain the canonical contract.
- TUI, CLI, ACP, tool results, and configured references should produce the same `FilePart` inputs as web/desktop.
- `opencode serve` and desktop should share frontend media attachment components in `packages/app`.
- Desktop-specific native bridges should only provide capture conveniences such as file picker paths and clipboard bytes.
- Future clients should not need new provider code if they can submit valid file parts.

## Shared App UI

Implement shared app attachment support in `packages/app`, not separately in docs or only in desktop:

- Generalize `ImageAttachmentPart` to a media attachment prompt part that can represent image, PDF, audio, and video uploaded media references, with legacy data URLs still accepted for old drafts/history.
- Extend `components/prompt-input/files.ts` and `constants/file-picker.ts` to recognize audio and video MIME types and common extensions.
- Extend `createPromptAttachments` to accept audio/video files from file input, drag/drop, and paste when the browser exposes files.
- Replace `PromptImageAttachments` with a media attachment strip that renders image thumbnails, PDF/file badges, audio badges, and video badges. The renderer should keep compact stable labels and not require a preview player for initial support.
- Extend `build-request-parts.ts` so web/desktop prompt media attachments become normal SDK `file` parts with the detected MIME and the resolved URL/reference.
- Use browser `File`/`Blob` APIs to upload selected files to the connected OpenCode server so `opencode serve` works from a normal browser. Use object URLs only for local UI previews; do not rely on browser-local filesystem paths because a remote or separate server cannot read them.
- Add a local server upload endpoint or equivalent server-managed media store before accepting large browser/desktop media that should not be embedded as data URLs. Store uploads in OpenCode user cache/state, not the repo, and submit the returned server-local `file://` part through the canonical prompt API.
- Keep desktop native file picker output as a convenience for local sidecar sessions. On Windows with WSL path conversion enabled, preserve the existing path conversion behavior for file-path references; for browser-selected blobs, use the same upload/data path as the web app.

Cross-platform requirements:

- Test Windows paths, UNC paths, file URLs, and WSL conversion on this Windows machine.
- Design path and upload handling with POSIX paths in mind and avoid hard-coded Windows separators.
- Prefer standard browser APIs in `packages/app` so macOS/Linux desktop and `opencode serve` do not need separate feature implementations.
- Add app unit tests around MIME detection, request-part building, and attachment history. Add Playwright coverage for at least browser drag/drop or file selection once implementation starts.

## Canonical Attachment Representation

Keep stored file parts as:

```ts
{
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}
```

Supported `url` forms:

- `file:` for user-selected local files before prompt resolution.
- `data:` for inline base64 bytes after prompt resolution or direct SDK callers.
- `http:`/`https:` for provider-downloadable media where the provider supports URL fetch.
- `gemini-file:` or a metadata wrapper for Gemini Files API file references. The exact URI encoding should avoid overloading normal HTTPS URLs; it must preserve provider, file URI, MIME, display name, and expiry/creation metadata.
- `gs:` or `https://storage.googleapis.com/...` for Gemini-compatible GCS references when explicitly provided by the caller.
- `https://www.youtube.com/...` and `https://youtu.be/...` for Gemini API YouTube URL input.

Do not add separate `AudioPart` or `VideoPart` schemas. MIME type and provider strategy are enough.

## Media Classification

Extend `packages/opencode/src/util/media.ts`:

- `isAudioAttachment(mime)` for `audio/*`.
- `isVideoAttachment(mime)` for `video/*`.
- `isMedia(mime)` to include image, PDF, audio, and video.
- `mimeToModality` in `ProviderTransform` already supports audio/video by prefix, so keep that mapping.
- `sniffAttachmentMime` should recognize common audio/video signatures when practical, but extension/MIME detection from `AppFileSystem.mimeType` remains the primary path.

The read tool should return binary file attachments for audio/video the same way it already returns image/PDF attachments, subject to attachment config limits.

## Attachment Limits

Extend config under `attachment`:

```json
{
  "attachment": {
    "image": { "auto_resize": true, "max_base64_bytes": 4718592 },
    "audio": { "max_base64_bytes": 20971520, "max_duration_seconds": 3600 },
    "video": { "max_base64_bytes": 20971520, "max_duration_seconds": 60 }
  }
}
```

Only enforce fields OpenCode can measure cheaply without adding heavyweight media probing. Initial implementation should enforce bytes reliably and leave duration validation for future metadata/probe support unless a lightweight existing dependency is already available.

Provider-specific limit resolution:

- Inline Gemini API media: cap total request at the current documented Gemini inline limit, presently 100 MB including prompt, system, and files; keep PDFs at the documented 50 MB ceiling.
- Gemini Files API: prefer upload/file URI references for local Gemini API-key audio/video/PDF where supported, and require it when media would exceed inline limits or should be reused.
- OpenAI-compatible / OpenCode Go: do not assume audio/video support just because a model modality says so. Use provider strategy allowlists and live tests.
- OAuth gateways: cap inline payload conservatively until tested.

## Provider Strategy Model

Add an internal provider media strategy resolver. It should not replace model capabilities.

Strategy dimensions:

- Accepted modalities: audio, video, image, PDF.
- Video audio semantics: preserves audio track, visual-only, rejects audio-bearing videos, or unknown.
- Accepted URL schemes: data, file after resolution, HTTP(S), Gemini file URI, GCS URI, YouTube URL.
- Preferred transport per modality and size: inline AI SDK file, provider URL, Gemini Files API upload, or reject.
- Upload support and cache policy.
- Provider-specific request options needed to express the transport.

Initial strategies:

- `@ai-sdk/google` with API key: prefer Gemini Files API/file URI references for local audio/video/PDF where supported; allow inline only for small payloads, explicit inline callers, or fallback paths; pass Gemini-supported YouTube URLs directly; allow file URI and GCS references.
- `@ai-sdk/google-vertex`: inline under provider limits; GCS URI support where available; Vertex file/upload strategy only if official SDK/provider path supports it.
- `opencode` / OpenCode Zen / OpenCode Go: inline only for models and endpoints confirmed by contract/live tests; no Gemini Files API unless the endpoint documents it.
- `@ai-sdk/openai`: preserve image/PDF behavior; do not add audio/video except models/endpoints documented and represented by `models.dev`.
- `@ai-sdk/anthropic`: preserve image/PDF behavior; do not add audio/video.
- `@ai-sdk/alibaba` and any Anthropic-compatible Go route for Qwen Plus: candidate visual-video paths when model metadata and provider docs agree; do not treat Qwen Plus video as audio-capable unless provider docs and live tests prove it.
- Gemini CLI OAuth plugin path: separate strategy; inline only after live confirmation; no Gemini Files API assumption.
- Antigravity OAuth path: separate strategy; inline only after live confirmation; keep Google Search/tool constraints independent from media.

## Gemini API-Key Transport

For Gemini API-key provider (`google` / `@ai-sdk/google`):

1. For local audio/video/PDF files, prefer upload through the Gemini Files API using the API key from OpenCode auth/config/env, then send AI SDK file parts backed by the returned Gemini file URL/URI.
2. For small direct data URLs or explicit inline callers, send AI SDK file parts and let the Google provider convert to Gemini inline data, provided the computed request remains within documented inline limits.
3. Store upload metadata in a user-level cache under OpenCode data/cache, not the repo.
4. Reuse uploaded files by content hash, provider, MIME, and file size while valid.
5. Poll file processing state for video before issuing `generateContent`.
6. Send Gemini file URI references in the request once available. Current AI SDK Google provider conversion can express Gemini file and YouTube URLs as URL-backed file parts, so OpenCode should stage uploads before AI SDK message conversion instead of replacing the AI SDK call path.

Implementation validation item: before coding the Gemini upload path, inspect the current AI SDK Google provider request conversion and prove whether Gemini file URI and YouTube URL parts can be expressed directly. If not, wrap `fetch` or provider options for Google only, rather than changing the canonical OpenCode message shape.

## OAuth Gateway Transport

Gemini CLI and Antigravity OAuth paths must not share Gemini API-key upload code by default.

Design requirements:

- Keep their auth methods under plugin/provider auth, not normal Gemini API-key auth.
- Treat Code Assist / Cloud Code gateway request shape as Gemini-style `contents[].parts[]`.
- Avoid sending Files API calls unless the gateway explicitly supports them.
- Do not assume YouTube URL support.
- Add live experiments for inline audio and inline video against both header styles.
- If live experiments fail, expose audio/video as unsupported for those strategies even if the underlying model family could support them elsewhere.

## OpenCode Go / MiMo Handling

OpenCode Go endpoints currently expose public model IDs but not rich modality metadata. The spec therefore requires:

1. A provider contract test that captures the actual outgoing request shape for `opencode-go` models with audio/video parts.
2. Manual protected live tests with the user's Go subscription secret.
3. Enable audio/video per provider/model/transport only after the endpoint accepts the payload and response behavior matches the expected modality.

MiMo-specific expected path:

- `mimo-v2.5` is the current `opencode-go` MiMo model metadata candidate for text/image/audio/video. It should be the first MiMo Go live-test target for audio and video.
- `mimo-v2.5-pro` should initially remain text-only or existing behavior unless model metadata changes or live tests prove more.
- Do not infer capabilities from a bare MiMo marketing suffix. Use provider ID plus model ID plus the current OpenCode model catalog.
- Do not add model-specific implementation for older MiMo variants. The correct implementation is metadata-driven: every provider/model whose catalog metadata and transport strategy allow audio and/or video should use the same path.

Kimi and Qwen expected path:

- `kimi-k2.5` and `kimi-k2.6` are visual-video candidates, not audio candidates, because current metadata lists video but not audio and official Kimi K2.5 docs describe text/image/video input.
- `qwen3.5-plus` and `qwen3.6-plus` are visual-video candidates, not audio candidates, because current metadata and Alibaba docs list text/image/video. Alibaba docs separately mark Qwen Omni models as also supporting audio input.
- If a user attaches a video with an audio track to Kimi/Qwen Plus, OpenCode should either send it with a visual-only warning after live tests prove the provider accepts such containers, strip/extract only the visual stream if local preprocessing is added later, or reject it clearly.

## Plugin Versus Fork

The first-class multimodal implementation needs fork/core changes, not only an OpenCode plugin.

Plugins are useful for provider-specific experiments because current hooks can add auth methods, provider model metadata, request headers, chat params, message transforms, tool definitions, shell env, and command/tool hooks. That is enough for prototyping an OAuth gateway provider, a custom provider auth flow, or a request-shape experiment.

Plugins are not enough for the core feature because this design touches:

- Public prompt input schema and generated SDK behavior.
- Message storage and model-message conversion semantics.
- Attachment config and MIME classification.
- CLI `--file`, TUI paste/drop, tool-result media handling, and ACP input.
- Shared `packages/app` web/desktop prompt UI, browser file handling, and likely local upload endpoints.
- Provider strategy resolution before the AI SDK call.
- Cross-platform desktop platform bridges and tests.

Decision: implement the canonical attachment pipeline in the fork/core. Keep plugins as optional provider adapters or live-experiment vehicles after the core file-part pipeline can represent audio/video correctly.

## Tool Results

Tool output currently stores `attachments` on completed tool parts. Extend this path so audio/video attachments:

- Remain attached to the tool result when the provider supports media in tool results.
- Are extracted into a synthetic user message when provider tool-result media support is absent but user-message media is supported.
- Become explicit text errors when the model does not support the modality.

The existing `supportsMediaInToolResult` should become provider-strategy backed instead of hard-coded image/PDF assumptions.

## SDK And API Compatibility

No breaking API change is required.

Existing file part input remains valid:

```json
{
  "type": "file",
  "mime": "audio/mpeg",
  "filename": "meeting.mp3",
  "url": "file:///absolute/path/meeting.mp3"
}
```

SDK generation should pick up schema docs from the existing prompt input shape. If adding transport metadata becomes necessary, add it as optional metadata/source fields, not required fields.

## Security And Secrets

- Never commit API keys, OAuth tokens, upload URLs, generated media caches, or HTTP recordings containing secrets.
- Auth stays in OpenCode user-level auth (`auth.json` or existing auth service), environment variables, or protected GitHub Actions secrets.
- Gemini Files API upload cache must live outside the repo and redact file URIs in debug logs unless the user explicitly enables verbose local debugging.
- Live tests must be manual-dispatch only and run in a protected environment.
- Recorded tests must redact `Authorization`, `x-goog-api-key`, upload URLs, file URIs if provider-sensitive, request IDs, and media payload bytes.
- Do not ask for the user's OpenCode Go subscription, Google AI Pro subscription, Gemini API key, Moonshot key, Alibaba key, or OAuth account until protected live experiments are ready. At that point, ask explicitly for only the credential needed for the next experiment and keep it in the existing OpenCode auth store, local environment, or protected secret store.

## Test Strategy

Normal CI, no secrets:

- Unit tests for MIME classification and attachment config parsing.
- Prompt resolution tests for `file:` audio/video conversion into data URL file parts.
- `MessageV2.toModelMessagesEffect` tests for user audio/video, tool-result audio/video, `stripMedia`, and unsupported modality conversion.
- Provider strategy tests for `google`, `google-vertex`, `opencode`, OAuth gateway strategies, and unknown providers.
- TUI prompt part tests for audio/video virtual labels and prompt history round-trip.
- CLI `--file` tests for detected MIME.
- SDK schema generation check after modifying prompt/config schema.

Provider contract tests with fake transports:

- Google inline audio/video request shape.
- Gemini Files API upload and polling flow with fake HTTP.
- OpenCode Go candidate request shape through OpenAI-compatible, Alibaba-compatible, and Anthropic-compatible adapters until the Qwen Go route discrepancy is resolved.
- OAuth gateway inline request shape against local transformed request payloads from reference plugins.

Protected live experiments:

- Gemini API key: small inline MP3/MP4 under the documented inline request limit, Files API MP3, Files API MP4 including an oversized local-video case, and YouTube URL.
- OpenCode Go: candidate MiMo/Kimi/Qwen audio/video requests against subscription endpoint.
- Gemini CLI OAuth: inline audio/video after OAuth setup.
- Antigravity OAuth: inline audio/video for Gemini routes after OAuth setup.
- Shared app UI: manual Windows desktop and `opencode serve` browser tests with small image/PDF/audio/video files; follow-up macOS/Linux validation should be requested or covered by CI/browser tests where practical.

Live experiments should return concise pass/fail summaries and scrub request/response details.

## Current Implementation Status

This section records the implementation state after the first multimodal branch pass. It is intentionally stricter than "code exists": a surface is only complete when its entry path, provider conversion, user-visible error behavior, and at least one appropriate verification path are covered.

### Implemented And Covered

- Shared `packages/app` prompt UI now accepts image, PDF, audio, and video files through the common browser/desktop attachment path.
- Browser and desktop shared UI uploads selected media through `/file/upload`, receives a server-local `file://` part, keeps only object URLs for local preview, and submits the returned file part through the existing prompt API.
- The server upload route stores media under the OpenCode user data directory, rejects unsupported MIME types, rejects uploads above the configured route limit before persistence when possible, and returns canonical `FilePartInput` metadata.
- CLI `opencode run --file` now sniffs media MIME from file bytes instead of forcing every file to `text/plain`, while preserving directory behavior and avoiding ambiguous TypeScript-as-video misclassification.
- TUI path-paste handling recognizes image, PDF, audio, and video files, renders stable media labels such as `Image`, `PDF`, `Audio`, and `Video`, and continues to use file parts rather than a separate media schema.
- The read tool can return image, PDF, audio, and video attachments for supported media files.
- `MessageV2.toModelMessagesEffect` converts audio/video user file parts into AI SDK file content and strips or extracts media consistently when compaction/tool-result handling requires it.
- Provider strategy and Gemini staging code distinguish model capability from transport capability. Google API-key media can be staged through Gemini Files API; Gemini YouTube URLs pass through as URL-backed file parts; custom/OAuth-style Google transports stay inline with explicit size checks.
- Focused tests cover shared app attachment upload, request-part building, server upload, CLI MIME detection, TUI media labels, media read tool behavior, message conversion, provider strategy, Gemini Files staging, YouTube request shape, and audio/video prompt resolution.
- Chrome E2E has verified the local shared web app with a real uploaded MP4 and Gemini 3.1 Flash Lite. The composer and timeline preserved the `video/mp4` attachment, Gemini answered semantically about the video, the backend stored the browser upload under the OpenCode user data upload directory, and Gemini Files API listed the uploaded `ui-real-clip.mp4` as ACTIVE with a `v1beta/files/...` URI.

### Partially Covered Or Not Yet Proven

- Desktop is code-covered through shared `packages/app`, but packaged desktop sidecar behavior has not been separately smoke-tested. Native picker, sidecar credential routing, WSL path conversion, and desktop-to-remote-server behavior still need explicit verification.
- TUI is covered by unit tests and code-path inspection, but it lacks a polished pre-send UX for provider/model modality rejection and inline-size limits. Live terminal E2E with real audio/video and a real provider has not been run.
- CLI is covered for MIME detection and core prompt flow, but provider-limit and oversize behavior should be documented in user-facing errors for non-Gemini inline-only providers.
- ACP, MCP resource, SDK-only clients, and plugins can submit `FilePartInput` values, but they do not get the shared upload UI or preflight UX. They should be considered API-compatible rather than UX-complete.
- Gemini API-key path is the best-proven provider path. Gemini OAuth / Antigravity-style providers intentionally do not use Gemini Files API and still need live inline-size and request-shape testing.
- OpenCode Go, MiMo v2.5, Kimi K2.5/K2.6, Qwen Plus visual-video, and any audio/video OpenAI-compatible path still require protected live provider tests before the branch can claim provider-specific support.
- Large local media is not automatically chunked or transcoded. Current behavior is stage through Gemini Files API where the strategy supports it, keep inline only within configured limits for inline-only transports, or reject clearly. Automatic chunking remains a separate design decision.

### Merge Readiness Criteria

The branch should not be marked ready to merge until these are true:

1. The PR diff contains only our multimodal commits and no upstream catch-up commits.
2. `upstream/dev` has been merged or rebased cleanly, then focused tests and package typechecks have been rerun from package directories.
3. Shared web app upload/send has been verified in Chrome with a real uploaded MP4 and the timeline shows the sent media attachment. Completed on Windows Chrome against the local shared app dev UI and local `opencode serve` backend.
4. Packaged or dev desktop sidecar smoke has verified at least one uploaded audio/video attachment path, or the PR explicitly documents desktop as shared-app covered but not packaged-E2E verified.
5. TUI or CLI live smoke has verified at least one local audio/video `file://` attachment path.
6. Gemini API-key Files API staging has been verified with request-shape evidence that the model call uses a Files API URI, not inline base64, for a local MP4. Completed for the Chrome UI smoke by confirming an ACTIVE Gemini Files API entry for the uploaded MP4.
7. OAuth/Antigravity/custom-Google behavior is either live-tested and documented or explicitly scoped as inline-only/experimental with size-limit rejection.
8. Remaining provider-specific claims for OpenCode Go, MiMo, Kimi, and Qwen are limited to metadata/strategy support unless protected live tests pass.
9. An external code review has been run with the project vision, implemented scope, known gaps, and verification evidence included in the review prompt.

## Implementation Boundary

Implementation should happen only after this spec is approved. The implementation branch should start from current `upstream/dev` merged into local `dev` or from a new clean branch based on `upstream/dev`, depending on the user's preference at implementation time.

## References

- Upstream OpenCode source: `packages/opencode/src/session/message-v2.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/provider/transform.ts`, `packages/opencode/src/config/attachment.ts`, `packages/opencode/src/util/media.ts`.
- Official AI SDK prompts docs: https://ai-sdk.dev/docs/foundations/prompts
- Official AI SDK ModelMessage docs: https://ai-sdk.dev/docs/reference/ai-sdk-core/model-message
- Official Gemini audio docs: https://ai.google.dev/gemini-api/docs/audio
- Official Gemini video docs: https://ai.google.dev/gemini-api/docs/video-understanding
- Official Gemini Files API docs: https://ai.google.dev/api/files
- Models.dev API: https://models.dev/api.json
- Official Kimi K2.5 docs: https://platform.kimi.ai/docs/guide/kimi-k2-5-quickstart
- Official Alibaba Cloud visual understanding docs: https://www.alibabacloud.com/help/en/model-studio/vision-model/
- OpenCode Go docs: https://dev.opencode.ai/docs/go/
- OpenCode docs: `packages/web/src/content/docs/go.mdx`, `packages/web/src/content/docs/providers.mdx`, `packages/web/src/content/docs/config.mdx`, `packages/web/src/content/docs/plugins.mdx`.
- Local `opensrc` references: `github.com/jenslys/opencode-gemini-auth`, `github.com/NoeFabris/opencode-antigravity-auth`.
