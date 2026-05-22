const path = require("node:path");
const { createRegistry } = require("./lib/registry");

const VERSION = "0.1.0";

function printHelp() {
  process.stdout.write(
    [
      "DSM - Dreamy Server Manager",
      "Usage:",
      "  -version | -v",
      "  -info | -f",
      "  -query | -q <identifier>",
      "  -install | -i <identifier> [name]",
    ].join("\n") + "\n"
  );
}

function getDataDir() {
  return process.env.DSM_DATA_DIR || path.resolve(process.cwd(), "data");
}

async function run(argv = process.argv.slice(2)) {
  const command = argv[0];
  const registry = createRegistry({ rootDir: getDataDir() });

  switch (command) {
    case "-version":
    case "-v":
      process.stdout.write(`DSM version ${VERSION}\n`);
      return 0;
    case "-info":
    case "-f":
      process.stdout.write("Dreamy Server Manager\n");
      process.stdout.write("Windows-first panel inspired by Blueprint\n");
      process.stdout.write(`Version: ${VERSION}\n`);
      process.stdout.write(`Data dir: ${getDataDir()}\n`);
      return 0;
    case "-query":
    case "-q": {
      const identifier = argv[1];
      if (!identifier) {
        process.stderr.write("Missing identifier\n");
        return 1;
      }
      const extension = await registry.getExtension(identifier);
      if (!extension) {
        process.stderr.write("Extension not found\n");
        return 1;
      }
      process.stdout.write(`${JSON.stringify(extension, null, 2)}\n`);
      return 0;
    }
    case "-install":
    case "-i": {
      const identifier = argv[1];
      const name = argv[2] || identifier;
      if (!identifier) {
        process.stderr.write("Missing identifier\n");
        return 1;
      }
      const extension = await registry.installExtension({
        identifier,
        name,
        description: "",
        version: VERSION,
        target: "beta-2025-09",
      });
      process.stdout.write(`Installed ${extension.identifier}\n`);
      return 0;
    }
    case "-help":
    case "-h":
    case undefined:
      printHelp();
      return 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      printHelp();
      return 1;
  }
}

if (require.main === module) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  run,
};

