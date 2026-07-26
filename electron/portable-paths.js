const path = require("node:path");

const PORTABLE_DATA_DIRECTORY_NAME = "Dreamy Server Manager Data";

function resolveStorageRoot({
  isPackaged,
  cwd = process.cwd(),
  execPath = process.execPath,
  portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR,
} = {}) {
  if (!isPackaged) {
    return path.resolve(cwd);
  }

  const executableDirectory = portableExecutableDir
    ? path.resolve(portableExecutableDir)
    : path.dirname(path.resolve(execPath));
  return path.join(executableDirectory, PORTABLE_DATA_DIRECTORY_NAME);
}

module.exports = {
  PORTABLE_DATA_DIRECTORY_NAME,
  resolveStorageRoot,
};
