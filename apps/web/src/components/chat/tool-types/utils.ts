export const formatInlineValue = (value: unknown): string => {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => formatInlineValue(item)).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      console.warn("Failed to stringify inline value", error);
      return String(value);
    }
  }
  return String(value);
};

export const formatMultilineValue = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.warn("Failed to stringify multiline value", error);
    return String(value);
  }
};
