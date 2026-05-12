import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { resolveFilePartForRun } from "../../../src/cli/cmd/run"

let tmpdir: string | undefined

async function tempdir() {
  tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-run-file-"))
  return tmpdir
}

afterEach(async () => {
  if (tmpdir) await fs.rm(tmpdir, { recursive: true, force: true })
  tmpdir = undefined
})

describe("run file attachments", () => {
  test("detects audio MIME from file bytes", async () => {
    const file = path.join(await tempdir(), "voice.bin")
    await fs.writeFile(file, new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]))

    expect(await resolveFilePartForRun(file)).toEqual({
      type: "file",
      url: pathToFileURL(file).href,
      filename: "voice.bin",
      mime: "audio/mpeg",
    })
  })

  test("detects video MIME from file bytes", async () => {
    const file = path.join(await tempdir(), "clip.bin")
    await fs.writeFile(file, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]))

    expect(await resolveFilePartForRun(file)).toMatchObject({
      filename: "clip.bin",
      mime: "video/webm",
    })
  })

  test("keeps directory MIME unchanged", async () => {
    const dir = path.join(await tempdir(), "assets")
    await fs.mkdir(dir)

    expect(await resolveFilePartForRun(dir)).toEqual({
      type: "file",
      url: pathToFileURL(dir).href,
      filename: "assets",
      mime: "application/x-directory",
    })
  })

  test("does not promote TypeScript extension fallback to video", async () => {
    const file = path.join(await tempdir(), "code.ts")
    await fs.writeFile(file, "export const answer = 42\n")

    expect(await resolveFilePartForRun(file)).toMatchObject({
      filename: "code.ts",
      mime: "text/plain",
    })
  })
})
