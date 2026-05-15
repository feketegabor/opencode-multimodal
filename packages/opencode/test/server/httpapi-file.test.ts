import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { Instance } from "../../src/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { fileURLToPath } from "url"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, query?: Record<string, string>) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      headers: {
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

function upload(directory: string, body: BodyInit, headers?: Record<string, string>) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request("http://localhost/file/upload", {
      method: "POST",
      headers: {
        "x-opencode-directory": directory,
        "x-opencode-filename": "clip.mp4",
        "content-type": "video/mp4",
        ...headers,
      },
      body,
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")

    const [list, content, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toContainEqual({ path: "hello.txt", added: 1, removed: 0, status: "added" })
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, files, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(await files.json()).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })

  test("uploads browser media as a server-local file part", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await upload(tmp.path, new Uint8Array([1, 2, 3]))

    expect(response.status).toBe(200)
    const part = (await response.json()) as {
      type: string
      mime: string
      filename: string
      url: string
      source?: { type: string; path: string; text: { value: string; start: number; end: number } }
    }
    expect(part).toMatchObject({
      type: "file",
      mime: "video/mp4",
      filename: "clip.mp4",
      source: {
        type: "file",
        text: { value: "clip.mp4", start: 0, end: 8 },
      },
    })
    expect(part.url.startsWith("file://")).toBe(true)
    expect(await Bun.file(fileURLToPath(part.url)).bytes()).toEqual(new Uint8Array([1, 2, 3]))
    expect(part.source?.path).toBe(fileURLToPath(part.url))
  })

  test("uses normalized upload MIME when browser file type is generic", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await upload(tmp.path, new Uint8Array([1, 2, 3]), {
      "content-type": "application/octet-stream",
      "x-opencode-mime": "video/mp4",
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      type: "file",
      mime: "video/mp4",
      filename: "clip.mp4",
    })
  })

  test("rejects oversized browser media uploads before persistence", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await upload(tmp.path, new Uint8Array([1]), {
      "content-length": String(101 * 1024 * 1024),
    })

    expect(response.status).toBe(413)
  })

  test("rejects non-attachment MIME types for browser uploads", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await upload(tmp.path, new Uint8Array([1]), {
      "content-type": "application/octet-stream",
    })

    expect(response.status).toBe(415)
  })
})
