/** OpenAI tile formula: https://developers.openai.com/api/docs/guides/images-vision
 * Fit within 2048², then shrink shortest side to at most 768 (never enlarge).
 * High = base + ceil(width/512)*ceil(height/512)*tile; low = base.
 * Estimates are not exact tokenizer counts or organization TPM reservations.
 */
export type ImageDetail = "high" | "low";
export function estimateImageTokens(model: string, width: number, height: number, detail: ImageDetail): number {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error("Invalid image dimensions");
  let base: number, tile: number;
  if (/^gpt-4o-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) { base = 2833; tile = 5667; }
  else if (/^(gpt-4o|gpt-4\.1)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) { base = 85; tile = 170; }
  else throw new Error(`No verified vision token estimator for model ${model}`);
  if (detail === "low") return base;
  const scale = Math.min(1, 2048 / Math.max(width, height), 768 / Math.min(width, height));
  return base + Math.ceil(Math.floor(width * scale) / 512) * Math.ceil(Math.floor(height * scale) / 512) * tile;
}

export function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Renderer output is not a PNG with an IHDR header");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error("Invalid PNG dimensions");
  return { width, height };
}

// UTF-8 bytes + envelope allowance deliberately overestimate text, including Arabic.
export function estimateTextTokens(text: string): number { return Buffer.byteLength(text, "utf8") + 64; }

export function groundingSizingConfig(env = process.env): { detail: ImageDetail; target: number } {
  const detail = env.GROUNDING_IMAGE_DETAIL ?? "high";
  const target = Number(env.GROUNDING_REQUEST_TOKEN_TARGET ?? 90000);
  if (detail !== "high" && detail !== "low") throw new Error("GROUNDING_IMAGE_DETAIL must be high or low");
  if (!Number.isSafeInteger(target) || target < 5000 || target > 100000) throw new Error("GROUNDING_REQUEST_TOKEN_TARGET must be an integer between 5000 and 100000");
  return { detail, target };
}

export type SizedPage = { page: number; imagePath: string; imageTokens: number };
export function planGroundingChunks(pages: SizedPage[], target: number, outputTokens: number, textTokens: (start: number, end: number) => number): SizedPage[][] {
  const chunks: SizedPage[][] = [];
  let current: SizedPage[] = [];
  for (const page of pages) {
    const previous = current.at(-1) ?? chunks.at(-1)?.at(-1);
    if (previous && page.page !== previous.page + 1) throw new Error("Grounding pages must be contiguous and ordered");
    if (page.imageTokens + textTokens(page.page, page.page) + outputTokens > target) throw new Error(`Grounding page ${page.page} exceeds the request token target; no AI request sent`);
    const next = [...current, page];
    if (current.length && next.reduce((n, p) => n + p.imageTokens, 0) + textTokens(next[0].page, page.page) + outputTokens > target) {
      chunks.push(current); current = [page];
    } else current = next;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
