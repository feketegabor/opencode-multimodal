import { Component, For, Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { MediaAttachmentPart } from "@/context/prompt"

type PromptMediaAttachmentsProps = {
  attachments: MediaAttachmentPart[]
  onOpen: (attachment: MediaAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

const imageButtonClass =
  "size-16 rounded-md border border-border-base hover:border-border-strong-base transition-colors overflow-hidden"
const imageClass = "size-full object-cover"
const tileClass =
  "h-16 w-36 rounded-md bg-surface-base border border-border-base flex items-center gap-2 px-2 pr-6 text-left"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
const imageNameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

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
                    <div class={tileClass}>
                      <FileIcon node={{ path: attachment.filename, type: "file" }} mono class="size-5 shrink-0 text-text-weak" />
                      <div class="min-w-0 flex-1">
                        <div class="text-12-medium text-text-base truncate">{attachment.filename}</div>
                        <div class="text-10-regular text-text-weak truncate">{attachment.mime}</div>
                      </div>
                    </div>
                  }
                >
                  <button type="button" class={imageButtonClass} onClick={() => props.onOpen(attachment)}>
                    <img src={attachment.dataUrl} alt={attachment.filename} class={imageClass} />
                    <div class={imageNameClass}>
                      <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                    </div>
                  </button>
                </Show>
                <button
                  type="button"
                  onClick={() => props.onRemove(attachment.id)}
                  class={removeClass}
                  aria-label={props.removeLabel}
                >
                  <Icon name="close" class="size-3 text-text-weak" />
                </button>
              </div>
            </Tooltip>
          )}
        </For>
      </div>
    </Show>
  )
}
