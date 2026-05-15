import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { ContentPart, Prompt } from "@/context/prompt"

let createPromptAttachments: typeof import("./attachments").createPromptAttachments

const toasts: Array<{ title: string; description?: string }> = []
const promptSets: Array<{ prompt: Prompt; cursor: number | undefined }> = []
const revoked: string[] = []
let promptValue: Prompt = []
let uploadedInputs: Array<{ file: File; mime?: string }>
let uploadAttachment: (file: File, mime?: string) => Promise<{ url: string }>

beforeAll(async () => {
  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (toast: { title: string; description?: string }) => {
      toasts.push(toast)
      return 0
    },
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({ t: (key: string) => key }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => ({ uploadAttachment }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptValue,
      cursor: () => undefined,
      set: (prompt: Prompt, cursor: number | undefined) => {
        promptValue = prompt
        promptSets.push({ prompt, cursor })
      },
    }),
  }))

  const mod = await import("./attachments")
  createPromptAttachments = mod.createPromptAttachments
})

beforeEach(() => {
  toasts.length = 0
  promptSets.length = 0
  revoked.length = 0
  uploadedInputs = []
  promptValue = []
  uploadAttachment = async (file, mime) => {
    uploadedInputs.push({ file, mime })
    return { url: "file:///uploads/clip.mp4" }
  }
  URL.createObjectURL = () => "blob:preview"
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
  }
})

function input() {
  return {
    editor: () => ({}) as HTMLDivElement,
    isDialogActive: () => false,
    setDraggingType: () => undefined,
    focusEditor: () => undefined,
    addPart: (_part: ContentPart) => true,
  }
}

describe("createPromptAttachments", () => {
  test("does not add partial attachments when upload fails", async () => {
    uploadAttachment = async () => {
      throw new Error("upload failed")
    }

    await createRoot(async (dispose) => {
      const attachments = createPromptAttachments(input())

      expect(await attachments.addAttachment(new File(["x"], "clip.mp4", { type: "video/mp4" }))).toBe(false)
      expect(promptSets).toHaveLength(0)
      expect(toasts).toHaveLength(1)

      dispose()
    })
  })

  test("revokes preview object URLs when the attachment controller unmounts", async () => {
    await createRoot(async (dispose) => {
      const attachments = createPromptAttachments(input())

      expect(await attachments.addAttachment(new File(["x"], "clip.mp4", { type: "video/mp4" }))).toBe(true)
      dispose()
      expect(revoked).toContain("blob:preview")
    })
  })

  test("uploads with the normalized attachment MIME", async () => {
    await createRoot(async (dispose) => {
      const attachments = createPromptAttachments(input())

      expect(await attachments.addAttachment(new File(["x"], "clip.mp4"))).toBe(true)
      expect(uploadedInputs).toMatchObject([{ mime: "video/mp4" }])

      dispose()
    })
  })
})
