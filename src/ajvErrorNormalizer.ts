import { AdditionalPropertiesParams, ComparisonParams, DependenciesParams, ErrorObject, TypeParams } from "ajv"

export function normaliseErrorMessages(errors: Array<ErrorObject>, schemeData: object) {
  const printer = new SchemeErrorPrinter(schemeData)
  return "Configuration is invalid.\n" +
    filterErrors(errors)
      .map(it => " - " + indent(printer.formatValidationError(it), "   ", false))
      .join("\n")
}

//tslint:disable-next-line:no-empty-interface
interface Scheme {
  // to ensure that proper arg is passed
}

class SchemeErrorPrinter {
  constructor(readonly schemeData: Scheme) {
  }

  formatValidationError(error: ErrorObject) {
    const dataPath = `configuration${error.dataPath}`
    if (error.keyword === "additionalProperties") {
      return `${dataPath} has an unknown property '${(error.params as AdditionalPropertiesParams).additionalProperty}'. These properties are valid:\n${this.getSchemaPartText(error.parentSchema)}`
    }
    else if (error.keyword === "oneOf" || error.keyword === "anyOf") {
      const children = (error as any).children
      if (children && children.length > 0) {
        // use set to remove duplicated messages like "should be an object."
        return `${dataPath} should be one of these:\n${this.getSchemaPartText(error.parentSchema)}\n` +
          `Details:\n${Array.from(new Set(children.map((it: ErrorObject) => " * " + indent(this.formatValidationError(it), "   ", false)))).join("\n")}`
      }
      return `${dataPath} should be one of these:\n${this.getSchemaPartText(error.parentSchema)}`

    }
    else if (error.keyword === "enum") {
      if (error.parentSchema && (error.parentSchema as any).enum && (error.parentSchema as any).enum.length === 1) {
        return `${dataPath} should be ${this.getSchemaPartText(error.parentSchema)}`
      }
      return `${dataPath} should be one of these:\n${this.getSchemaPartText(error.parentSchema)}`
    }
    else if (error.keyword === "allOf") {
      return `${dataPath} should be:\n${this.getSchemaPartText(error.parentSchema)}`
    }
    else if (error.keyword === "type") {
      switch ((error.params as TypeParams).type) {
        case "object":
          return `${dataPath} should be an object.`
        case "string":
          return `${dataPath} should be a string.`
        case "boolean":
          return `${dataPath} should be a boolean.`
        case "number":
          return `${dataPath} should be a number.`
        case "array":
          return `${dataPath} should be an array:\n${this.getSchemaPartText(error.parentSchema)}`
      }
      return `${dataPath} should be ${(error.params as TypeParams).type}:\n${this.getSchemaPartText(error.parentSchema)}`
    }
    else if (error.keyword === "instanceof") {
      return `${dataPath} should be an instance of ${this.getSchemaPartText(error.parentSchema)}.`
    }
    else if (error.keyword === "required") {
      const missingProperty = (error.params as DependenciesParams).missingProperty.replace(/^\./, "")
      return `${dataPath} misses the property '${missingProperty}'.\n${this.getSchemaPartText(error.parentSchema, ["properties", missingProperty])}`
    }
    else if (error.keyword === "minLength" || error.keyword === "minItems") {
      if ((error.params as ComparisonParams).limit === 1) {
        return `${dataPath} should not be empty.`
      }
      else {
        return `${dataPath} ${error.message}`
      }
    }
    else if (error.keyword === "absolutePath") {
      const baseMessage = `${dataPath}: ${error.message}`
      if (dataPath === "configuration.output.filename") {
        return `${baseMessage}\n` +
          "Please use output.path to specify absolute path and output.filename for the file name."
      }
      return baseMessage
    }
    else {
      // eslint-disable-line no-fallthrough
      return `${dataPath} ${error.message} (${JSON.stringify(error, null, 2)}).\n${this.getSchemaPartText(error.parentSchema)}`
    }
  }

  private getSchemaPart(path: string) {
    const pathList = path.split("/").slice(0, path.length)
    let schemaPart = this.schemeData as any
    for (let i = 1; i < pathList.length; i++) {
      const inner = schemaPart[pathList[i]]
      if (inner) {
        schemaPart = inner
      }
    }
    return schemaPart
  }

  private getSchemaPartText(schemaPart: any, additionalPath: Array<string> | null = null) {
    if (additionalPath != null) {
      for (const p of additionalPath) {
        const inner = schemaPart[p]
        if (inner) {
          schemaPart = inner
        }
      }
    }

    while (schemaPart.$ref != null) {
      schemaPart = this.getSchemaPart(schemaPart.$ref)
    }

    let schemaText = this.formatSchema(schemaPart)
    let description = schemaPart.description
    if (description != null) {
      description = description.trim()
      const twoLineBreakPosition = description.indexOf("\n\n")
      description = twoLineBreakPosition < 0 ? description : description.substring(0, twoLineBreakPosition)
      schemaText += `\n${description}\n`
    }
    return schemaText
  }

  private formatSchema(schema: any, prevSchemas?: any) {
    prevSchemas = prevSchemas || []

    const formatInnerSchema = (innerSchema: any, isAddSelf = false): string => {
      if (!isAddSelf) {
        return this.formatSchema(innerSchema, prevSchemas)
      }
      if (prevSchemas.indexOf(innerSchema) >= 0) {
        return "(recursive)"
      }
      return this.formatSchema(innerSchema, prevSchemas.concat(schema))
    }

    if (schema.type === "string") {
      if (schema.minLength === 1) {
        return "non-empty string"
      }
      else if (schema.minLength > 1) {
        return `string (min length ${schema.minLength})`
      }
      else {
        return "string"
      }
    }
    else if (schema.type === "boolean") {
      return "boolean"
    }
    else if (schema.type === "number") {
      return "number"
    }
    else if (schema.type === "object") {
      if (schema.properties) {
        const required = schema.required || []
        return `object { ${Object.keys(schema.properties).map(property => {
          if (required.indexOf(property) < 0) {
            return property + "?"
          }
          return property
        }).concat(schema.additionalProperties ? ["..."] : []).join(", ")} }`
      }
      if (schema.additionalProperties) {
        return `object { <key>: ${formatInnerSchema(schema.additionalProperties)} }`
      }
      return "object"
    }
    else if (schema.type === "array") {
      return `[${formatInnerSchema(schema.items)}]`
    }

    switch (schema.instanceof) {
      case "Function":
        return "function"
      case "RegExp":
        return "RegExp"
    }

    if (schema.$ref != null) {
      return formatInnerSchema(this.getSchemaPart(schema.$ref), true)
    }
    if (schema.allOf) {
      return schema.allOf.map(formatInnerSchema).join(" & ")
    }
    if (schema.oneOf) {
      return schema.oneOf.map(formatInnerSchema).join(" | ")
    }
    if (schema.anyOf) {
      return schema.anyOf.map(formatInnerSchema).join(" | ")
    }
    if (schema.enum) {
      return schema.enum.map((it: object) => JSON.stringify(it)).join(" | ")
    }
    return JSON.stringify(schema, null, 2)
  }
}

function indent(str: string, prefix: string, isFirstLine: boolean) {
  if (isFirstLine) {
    return prefix + str.replace(/\n(?!$)/g, "\n" + prefix)
  }
  else {
    return str.replace(/\n(?!$)/g, `\n${prefix}`)
  }
}

function filterErrors(errors: Array<ErrorObject>) {
  let newErrors: Array<any> = []
  for (const error of errors) {
    const dataPath = error.dataPath
    let children: Array<ErrorObject> = []
    newErrors = newErrors.filter(oldError => {
      if (!oldError.dataPath.includes(dataPath)) {
        return true
      }

      if (oldError.children != null) {
        children = children.concat(oldError.children.slice(0))
      }
      oldError.children = null
      children.push(oldError)
      return false
    })

    if (children.length > 0) {
      (error as any).children = children
    }
    newErrors.push(error)
  }
  return newErrors
}