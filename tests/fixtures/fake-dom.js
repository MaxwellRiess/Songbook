// A stand-in for the slice of the DOM the page readers walk, so the extraction
// paths can be exercised without a browser. The repository has no test-time
// dependencies, so this covers the handful of DOM methods the readers use
// rather than pulling in a full implementation.
export function element({ tag, classes = [], attributes = {}, properties = {}, children = [], text = "" }) {
  const node = {
    tagName: tag,
    children,
    classList: { contains: (name) => classes.includes(name) },
    style: { getPropertyValue: (name) => properties[name] || "" },
    getAttribute: (name) => attributes[name] ?? null,
    get textContent() {
      return text || children.map((child) => child.textContent).join("");
    },
    get innerText() {
      return node.textContent;
    },
    querySelector: (selector) => node.querySelectorAll(selector)[0] || null,
    querySelectorAll: (selector) => descendants(node).filter((candidate) => matches(candidate, selector))
  };
  return node;
}

export function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

export function matches(node, selector) {
  return selector.split(",").some((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith(".")) return node.classList.contains(trimmed.slice(1));
    if (trimmed.startsWith("[")) {
      const [, name, value] = trimmed.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/) || [];
      return name ? node.getAttribute(name) !== null && (value === undefined || node.getAttribute(name) === value) : false;
    }
    if (trimmed.startsWith("#")) return false;
    const [tag, attribute] = trimmed.split(/(?=\[)/);
    if (node.tagName !== tag.toUpperCase()) return false;
    return attribute ? matches(node, attribute) : true;
  });
}
