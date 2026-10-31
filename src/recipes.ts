// Where the connector catalogue is: a tested project with one connection and
// one flow per connector, shipped beside dist/ in the package.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The folder of the connector catalogue, a project `ingestron init` takes a
 * connection and flow from.
 * @example readdirSync(join(recipesFolder, "connections")) // ["adls-gen2.yaml", …]
 */
export const recipesFolder = join(dirname(fileURLToPath(import.meta.url)), "../recipes");
