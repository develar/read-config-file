import { promises as fs } from "fs"
import { load } from "js-yaml"
import * as path from "path"
import { Lazy } from "lazy-val"
import { parse as parseEnv } from "dotenv"
import { loadTsConfig } from "config-file-ts"

export interface ReadConfigResult<T> {
  readonly result: T
  readonly configFile: string | null
}

async function readConfig<T>(configFile: string, request: ReadConfigRequest): Promise<ReadConfigResult<T>> {
  const data = await fs.readFile(configFile, "utf8")
  let result
  if (configFile.endsWith(".json5") || configFile.endsWith(".json")) {
    result = require("json5").parse(data)
  }
  else if (configFile.endsWith(".js") || configFile.endsWith(".cjs")) {
    result = require(configFile)
    if (result.default != null) {
      result = result.default
    }
    if (typeof result === "function") {
      result = result(request)
    }
    result = await Promise.resolve(result)
  }
  else if (configFile.endsWith(".ts")) {
    result = loadTsConfig<T>(configFile)
    if (typeof result === "function") {
      result = result(request)
    }
    result = await Promise.resolve(result)
  }
  else if (configFile.endsWith(".toml")) {
    result = require("toml").parse(data)
  }
  else {
    result = load(data)
  }
  return {result, configFile}
}

export async function findAndReadConfig<T>(request: ReadConfigRequest): Promise<ReadConfigResult<T> | null> {
  const prefix = request.configFilename
  for (const configFile of [`${prefix}.yml`, `${prefix}.yaml`, `${prefix}.json`, `${prefix}.json5`, `${prefix}.toml`, `${prefix}.js`, `${prefix}.cjs`, `${prefix}.ts`]) {
    const data = await orNullIfFileNotExist(readConfig<T>(path.join(request.projectDir, configFile), request))
    if (data != null) {
      return data
    }
  }

  return null
}

export function orNullIfFileNotExist<T>(promise: Promise<T>): Promise<T | null> {
  return orIfFileNotExist(promise, null)
}

export function orIfFileNotExist<T>(promise: Promise<T>, fallbackValue: T): Promise<T> {
  return promise
    .catch(e => {
      if (e.code === "ENOENT" || e.code === "ENOTDIR") {
        return fallbackValue
      }
      throw e
    })
}

export interface ReadConfigRequest {
  packageKey: string
  configFilename: string

  projectDir: string
  packageMetadata: Lazy<{ [key: string]: any } | null> | null
}

export async function loadConfig<T>(request: ReadConfigRequest): Promise<ReadConfigResult<T> | null> {
  let packageMetadata = request.packageMetadata == null ? null : await request.packageMetadata.value
  if (packageMetadata == null) {
    const json = await orNullIfFileNotExist(fs.readFile(path.join(request.projectDir, "package.json"), "utf8"))
    packageMetadata = json == null ? null : JSON.parse(json)
  }

  const data: T = packageMetadata == null ? null : packageMetadata[request.packageKey]
  return data == null ? findAndReadConfig<T>(request) : {result: data, configFile: null}
}

export function getConfig<T>(request: ReadConfigRequest, configPath?: string | null): Promise<ReadConfigResult<T> | null> {
  if (configPath == null) {
    return loadConfig<T>(request)
  }
  else {
    return readConfig<T>(path.resolve(request.projectDir, configPath), request)
  }
}

export async function loadParentConfig<T>(request: ReadConfigRequest, spec: string): Promise<ReadConfigResult<T>> {
  let isFileSpec: boolean | undefined
  if (spec.startsWith("file:")) {
    spec = spec.substring("file:".length)
    isFileSpec = true
  }

  let parentConfig = await orNullIfFileNotExist(readConfig<T>(path.resolve(request.projectDir, spec), request))
  if (parentConfig == null && isFileSpec !== true) {
    let resolved: string | null = null
    try {
      resolved = require.resolve(spec)
    }
    catch (e) {
      // ignore
    }

    if (resolved != null) {
      parentConfig = await readConfig<T>(resolved, request)
    }
  }

  if (parentConfig == null) {
    throw new Error(`Cannot find parent config file: ${spec}`)
  }

  return parentConfig
}

export async function loadEnv(envFile: string) {
  const data = await orNullIfFileNotExist(fs.readFile(envFile, "utf8"))
  if (data == null) {
    return null
  }

  const parsed = parseEnv(data)
  for (const key of Object.keys(parsed)) {
    if (!process.env.hasOwnProperty(key)) {
      process.env[key] = parsed[key]
    }
  }
  require("dotenv-expand")(parsed)
  return parsed
}
