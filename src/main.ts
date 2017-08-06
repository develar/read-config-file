import { readFile, readJson } from "fs-extra-p"
import { safeLoad } from "js-yaml"
import * as path from "path"
import { deepAssign } from "./deepAssign"
import { Lazy } from "lazy-val"

export async function readConfig<T>(configFile: string, projectDir?: string, log?: (message: string) => void): Promise<T> {
  const data = await readFile(configFile, "utf8")
  let result
  if (configFile.endsWith(".json5") || configFile.endsWith(".json")) {
    result = require("json5").parse(data)
  }
  else if (configFile.endsWith(".toml")) {
    result = require("toml").parse(data)
  }
  else {
    result = safeLoad(data)
  }

  if (log != null && projectDir != null) {
    const relativePath = path.relative(projectDir, configFile)
    log(`Using ${relativePath.startsWith("..") ? configFile : relativePath} configuration file`)
  }
  return result
}

export async function findAndReadConfig<T>(dir: string, prefix: string, log?: (message: string) => void): Promise<T | null> {
  for (const configFile of [`${prefix}.yml`, `${prefix}.yaml`, `${prefix}.json`, `${prefix}.json5`, `${prefix}.toml`]) {
    const data = await orNullIfFileNotExist<T>(readConfig(path.join(dir, configFile), dir, log))
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

function getConfigFromPackageData(metadata: any | null, key: string) {
  return metadata == null ? null : metadata[key]
}

export interface ReadConfigRequest {
  key: string
  projectDir: string
  packageMetadata: Lazy<{ [key: string]: any } | null> | null

  log?: (message: string) => void
}

export async function loadConfig<T>(request: ReadConfigRequest): Promise<T | null> {
  let packageMetadata = request.packageMetadata == null ? null : await request.packageMetadata
  if (packageMetadata == null) {
    packageMetadata = await orNullIfFileNotExist(readJson(path.join(request.projectDir, "package.json")))
  }
  const data = getConfigFromPackageData(packageMetadata, request.key)
  return data == null ? findAndReadConfig<T>(request.projectDir, request.key, request.log) : data
}

export async function getConfig<T>(request: ReadConfigRequest, configPath: string | null, configFromOptions: T | null | undefined): Promise<T> {
  let fileOrPackageConfig: T | null
  if (configPath == null) {
    fileOrPackageConfig = await loadConfig<T>(request)
  }
  else {
    fileOrPackageConfig = await readConfig<T>(path.resolve(request.projectDir, configPath), request.projectDir, request.log)
  }

  return deepAssign(fileOrPackageConfig == null ? Object.create(null) : fileOrPackageConfig, configFromOptions)
}

export async function loadParentConfig<T>(request: ReadConfigRequest, spec: string): Promise<T> {
  let isFileSpec: boolean | undefined
  if (spec.startsWith("file:")) {
    spec = spec.substring("file:".length)
    isFileSpec = true
  }

  let parentConfig = await orNullIfFileNotExist(readConfig<T>(path.resolve(request.projectDir, spec), request.projectDir, request.log))
  if (parentConfig == null && isFileSpec !== true) {
    let resolved: string | null = null
    try {
      resolved = require.resolve(spec)
    }
    catch (e) {
      // ignore
    }

    if (resolved != null) {
      parentConfig = await readConfig<T>(resolved, request.projectDir, request.log)
    }
  }

  if (parentConfig == null) {
    throw new Error(`Cannot find parent config file: ${spec}`)
  }

  return parentConfig
}