import BluebirdPromise from "bluebird-lst"

async function readFile() {
  return readDirectory()
}

function readDirectory() {
  return BluebirdPromise.reject(new Error("test"))
}

readFile()