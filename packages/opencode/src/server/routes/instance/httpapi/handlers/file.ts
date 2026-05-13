import * as InstanceState from "@/effect/instance-state"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { randomUUID } from "crypto"
import { Effect } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { FilePaths } from "../groups/file"
import { WorkspaceRouteContext } from "../middleware/workspace-routing"

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]
  return value
}

function filename(request: HttpServerRequest.HttpServerRequest) {
  const raw = headerValue(request.headers["x-opencode-filename"]) ?? "attachment"
  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()
  return decoded.replace(/\0/g, "").split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "attachment"
}

function mime(request: HttpServerRequest.HttpServerRequest) {
  return (
    headerValue(request.headers["x-opencode-mime"]) ||
    headerValue(request.headers["content-type"])?.split(";")[0]?.trim() ||
    "application/octet-stream"
  )
}

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* File.Service
    const ripgrep = yield* Ripgrep.Service

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      return (yield* ripgrep
        .search({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).items
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      return yield* svc.search({
        query: ctx.query.query,
        limit: ctx.query.limit ?? 10,
        dirs: ctx.query.dirs !== "false",
        type: ctx.query.type,
      })
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      return yield* svc.list(ctx.query.path)
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      return yield* svc.read(ctx.query.path)
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return yield* svc.status()
    })

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("status", status)
  }),
)

export const fileUploadRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    yield* router.add(
      "POST",
      FilePaths.upload,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        yield* WorkspaceRouteContext
        const name = filename(request)
        const filepath = path.join(Global.Path.data, "uploads", `${randomUUID()}-${name}`)
        yield* fs.writeWithDirs(filepath, new Uint8Array(yield* Effect.orDie(request.arrayBuffer)))
        return HttpServerResponse.jsonUnsafe({
          type: "file",
          mime: mime(request),
          filename: name,
          url: pathToFileURL(filepath).href,
          source: {
            type: "file",
            path: filepath,
            text: { value: name, start: 0, end: name.length },
          },
        })
      }),
    )
  }),
)
