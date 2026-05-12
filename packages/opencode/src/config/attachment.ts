export * as ConfigAttachment from "./attachment"

import { Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"

export const Image = Schema.Struct({
  auto_resize: Schema.optional(Schema.Boolean).annotate({
    description: "Resize images before sending them to the model when they exceed configured limits (default: true)",
  }),
  max_width: Schema.optional(PositiveInt).annotate({
    description: "Maximum image width before resizing or rejecting the attachment (default: 2000)",
  }),
  max_height: Schema.optional(PositiveInt).annotate({
    description: "Maximum image height before resizing or rejecting the attachment (default: 2000)",
  }),
  max_base64_bytes: Schema.optional(PositiveInt).annotate({
    description: "Maximum base64 payload bytes for an image attachment (default: 5242880)",
  }),
}).annotate({ identifier: "ImageAttachmentConfig" })
export type Image = Schema.Schema.Type<typeof Image>

export const Audio = Schema.Struct({
  max_base64_bytes: Schema.optional(PositiveInt).annotate({
    description: "Maximum base64 payload bytes for an audio attachment (default: 20971520)",
  }),
  max_duration_seconds: Schema.optional(PositiveInt).annotate({
    description: "Maximum audio duration in seconds when duration can be measured cheaply (default: 3600)",
  }),
}).annotate({ identifier: "AudioAttachmentConfig" })
export type Audio = Schema.Schema.Type<typeof Audio>

export const Video = Schema.Struct({
  max_base64_bytes: Schema.optional(PositiveInt).annotate({
    description: "Maximum base64 payload bytes for a video attachment (default: 20971520)",
  }),
  max_duration_seconds: Schema.optional(PositiveInt).annotate({
    description: "Maximum video duration in seconds when duration can be measured cheaply (default: 60)",
  }),
}).annotate({ identifier: "VideoAttachmentConfig" })
export type Video = Schema.Schema.Type<typeof Video>

export const Info = Schema.Struct({
  image: Schema.optional(Image).annotate({ description: "Image attachment configuration" }),
  audio: Schema.optional(Audio).annotate({ description: "Audio attachment configuration" }),
  video: Schema.optional(Video).annotate({ description: "Video attachment configuration" }),
}).annotate({ identifier: "AttachmentConfig" })
export type Info = Schema.Schema.Type<typeof Info>
