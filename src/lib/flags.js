function parseFlags(flagsValue = "") {
  if (typeof flagsValue !== "string") {
    return [];
  }

  return flagsValue
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);
}

module.exports = {
  parseFlags,
};

