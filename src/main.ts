import { readFile, readJson } from "fs-extra-p"
import { safeLoad } from "js-yaml"
import * as path from "path"
import { deepAssign } from "./deepAssign"
import { Lazy } from "lazy-val"
import Ajv, { ErrorObject } from "ajv"
import { normaliseErrorMessages } from "./ajvErrorNormalizer"
import { parse as parseEnv } from "dotenv"

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

export async function findAndReadConfig<T>(request: ReadConfigRequest): Promise<T | null> {
  const prefix = request.configFilename
  for (const configFile of [`${prefix}.yml`, `${prefix}.yaml`, `${prefix}.json`, `${prefix}.json5`, `${prefix}.toml`]) {
    const data = await orNullIfFileNotExist<T>(readConfig(path.join(request.projectDir, configFile), request.projectDir, request.log))
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

  log?: (message: string) => void
}

export async function loadConfig<T>(request: ReadConfigRequest): Promise<T | null> {
  let packageMetadata = request.packageMetadata == null ? null : await request.packageMetadata.value
  if (packageMetadata == null) {
    packageMetadata = await orNullIfFileNotExist(readJson(path.join(request.projectDir, "package.json")))
  }
  const data = packageMetadata == null ? null : packageMetadata[request.packageKey]
  return data == null ? findAndReadConfig<T>(request) : data
}

export async function getConfig<T>(request: ReadConfigRequest, configPath?: string | null, configFromOptions?: T | null): Promise<T> {
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

export async function validateConfig(config: any, scheme: Lazy<any>, errorMessage: (error: string, errors: Array<ErrorObject>) => string) {
  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: true,
    verbose: true,
    errorDataPath: "configuration",
  })
  ajv.addMetaSchema(require("ajv/lib/refs/json-schema-draft-04.json"))
  require("ajv-keywords")(ajv, ["typeof"])
  const schema = await scheme.value
  const validator = ajv.compile(schema)

  if (!validator(config)) {
    throw new Error(errorMessage(normaliseErrorMessages(validator.errors!, schema), validator.errors!!))
  }
}

export async function loadEnv(envFile: string) {
  const data = await orNullIfFileNotExist(readFile(envFile, "utf8"))
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