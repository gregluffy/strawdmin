export const basePath =
  typeof window !== "undefined"
    ? ((window as any).__NEXT_BASE_PATH__ ?? "")
    : (process.env.BASE_PATH ?? "");
