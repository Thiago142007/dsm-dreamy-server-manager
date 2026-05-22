const ESCAPE_PREFIX = "__DSM_ESC__";

function applyModifier(value, modifier) {
  if (modifier === "!") {
    return value.toUpperCase();
  }

  if (modifier === "^") {
    if (value.length === 0) {
      return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  return value;
}

function renderPlaceholders(input, context = {}) {
  if (typeof input !== "string") {
    return input;
  }

  const escaped = [];
  let output = input.replace(/!\{([^}]+)\}/g, (_, placeholderBody) => {
    const token = `${ESCAPE_PREFIX}${escaped.length}__`;
    escaped.push(`{${placeholderBody}}`);
    return token;
  });

  output = output.replace(/\{([a-z_]+(?:\/[a-z_]+)?)([!^])?\}/gi, (full, key, modifier = "") => {
    const value = context[key];
    if (value === undefined || value === null) {
      return full;
    }

    return applyModifier(String(value), modifier);
  });

  return output.replace(new RegExp(`${ESCAPE_PREFIX}(\\d+)__`, "g"), (_, idx) => escaped[Number(idx)]);
}

module.exports = {
  renderPlaceholders,
};

