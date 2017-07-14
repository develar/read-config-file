import { readFile } from "fs-extra-p"
import { safeLoad } from "js-yaml"
import * as path from "path"

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