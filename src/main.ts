import { readFile, readJson } from "fs-extra-p"
import { safeLoad } from "js-yaml"
import * as path from "path"
import { Lazy } from "lazy-val"
import Ajv, { ErrorObject } from "ajv"
import { normaliseErrorMessages } from "./ajvErrorNormalizer"
import { parse as parseEnv } from "dotenv"

export interface ReadConfigResult<T> {
  readonly result: T
  readonly configFile: string | null
}

export async function readConfig<T>(configFile: string): Promise<ReadConfigResult<T>> {
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
  return {result, configFile}
}

export async function findAndReadConfig<T>(request: ReadConfigRequest): Promise<ReadConfigResult<T> | null> {
  const prefix = request.configFilename
  for (const configFile of [`${prefix}.yml`, `${prefix}.yaml`, `${prefix}.json`, `${prefix}.json5`, `${prefix}.toml`]) {
    const data = await orNullIfFileNotExist(readConfig<T>(path.join(request.projectDir, configFile)))
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
    packageMetadata = await orNullIfFileNotExist(readJson(path.join(request.projectDir, "package.json")))
  }
  const data: T = packageMetadata == null ? null : packageMetadata[request.packageKey]
  return data == null ? findAndReadConfig<T>(request) : {result: data, configFile: null}
}

export function getConfig<T>(request: ReadConfigRequest, configPath?: string | null): Promise<ReadConfigResult<T> | null> {
  if (configPath == null) {
    return loadConfig<T>(request)
  }
  else {
    return readConfig<T>(path.resolve(request.projectDir, configPath))
  }
}

export async function loadParentConfig<T>(request: ReadConfigRequest, spec: string): Promise<ReadConfigResult<T>> {
  let isFileSpec: boolean | undefined
  if (spec.startsWith("file:")) {
    spec = spec.substring("file:".length)
    isFileSpec = true
  }

  let parentConfig = await orNullIfFileNotExist(readConfig<T>(path.resolve(request.projectDir, spec)))
  if (parentConfig == null && isFileSpec !== true) {
    let resolved: string | null = null
    try {
      resolved = require.resolve(spec)
    }
    catch (e) {
      // ignore
    }

    if (resolved != null) {
      parentConfig = await readConfig<T>(resolved)
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
    const error = new Error(errorMessage(normaliseErrorMessages(validator.errors!, schema), validator.errors!!));
    (error as any).code = "ERR_CONFIG_INVALID"
    throw error
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