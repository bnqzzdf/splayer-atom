const normalize = (value: string): string => {
  let normalized = value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith("//")) {
    normalized = normalized.toLocaleLowerCase();
  }
  return normalized;
};

export const folderPathWithinRoot = (candidate: string, root: string): boolean => {
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot === "/" ? "/" : normalizedRoot + "/")
  );
};

export const appendFolderPath = (base: string, segment: string): string => {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return base.replace(/[\\/]+$/, "") + separator + segment;
};
