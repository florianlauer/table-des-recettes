// A recipe that continues overleaf needs two pages read together; three happens on a long magazine
// feature. Four leaves margin without ever letting an accidental thirty-file selection become one
// billed call.
export const MAX_IMAGES_PER_SCAN = 4

// MAX_INPUT_BYTES caps one image; four of them at the ceiling would be a 100 MB request before
// base64 expansion. This caps what actually leaves for the model.
export const MAX_SCAN_BYTES = 40 * 1024 * 1024

// A page yields a handful of recipes — four on the worst page measured during the spike. Reaching
// this many means the extraction is malformed, which is why the schema refuses it outright rather
// than letting the correction screen inherit the mess.
export const MAX_RECIPES_PER_SCAN = 50

// Homonyms come in ones and twos. The bound only exists so a pathological series cannot grow the
// transaction without limit; past it, the recipe id is the suffix.
export const SLUG_PROBE_LIMIT = 32
