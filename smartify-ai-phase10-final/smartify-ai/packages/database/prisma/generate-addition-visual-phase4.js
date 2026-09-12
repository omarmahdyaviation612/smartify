// Phase 4, Part C: ONE-OFF script that generates exactly ONE real AI image
// for the Addition pilot's existing EXAMPLE step (s4) visual slot, stores
// the bytes in the new LessonVisualAsset table, updates the topic's
// teachingStepsJson visual metadata to GENERATED, and logs the real cost
// to the existing AIUsage ledger. This is curriculum content generated
// once and reused by every student — not a per-student/per-request call —
// so it deliberately lives here as a manual script, not a runtime service.
//
// Model: dall-e-3 has been fully retired from this account (confirmed via
// GET /v1/models — only the newer "gpt-image" family is listed). Using
// gpt-image-2 (the current flagship in that family) at "medium" quality,
// 1024x1024 — approved after a first attempt failed technically (unknown
// model). Pricing is token-based, not a flat per-image price; the ACTUAL
// cost is computed below from the real `usage` the API returns, using
// OpenAI's published per-token image rates, not a guessed constant.
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const TOPIC_ID = "cmtxtrmfa000710sq5kuea4kq"; // Addition (Part 1) — the existing validated pilot topic
const STEP_ID = "s4"; // the EXAMPLE step already carrying visual metadata since Phase 2's seed
const IMAGE_MODEL = "gpt-image-2";
const IMAGE_SIZE = "1024x1024";
const IMAGE_QUALITY = "medium";
const ADMIN_USER_ID = "cmthp3g6d0000wlpcb10fpngr"; // the one SUPER_ADMIN account — this is an admin/curriculum action, not a student one

// Published per-token image pricing (USD per token, derived from the
// documented per-million rates: $5/1M text-input, $8/1M image-input,
// $2/1M cached image-input, $30/1M image-output tokens).
const RATE_PER_TOKEN_USD = {
  text_tokens: 5 / 1_000_000,
  image_tokens: 8 / 1_000_000,
  cached_tokens: 2 / 1_000_000,
  output_tokens: 30 / 1_000_000,
};

function computeCostUsd(usage) {
  if (!usage) return null;
  const inputDetails = usage.input_tokens_details ?? {};
  const textTokens = inputDetails.text_tokens ?? 0;
  const cachedTokens = inputDetails.cached_tokens ?? 0;
  const imageTokens = Math.max(0, (usage.input_tokens ?? 0) - textTokens - cachedTokens);
  const outputTokens = usage.output_tokens ?? 0;
  return (
    textTokens * RATE_PER_TOKEN_USD.text_tokens +
    cachedTokens * RATE_PER_TOKEN_USD.cached_tokens +
    imageTokens * RATE_PER_TOKEN_USD.image_tokens +
    outputTokens * RATE_PER_TOKEN_USD.output_tokens
  );
}

const PROMPT = [
  "A simple, warm, flat-style illustration for a young child (about 6-7 years old) learning basic addition for the first time.",
  "Show exactly 3 identical small red apples grouped together on the left side of the image.",
  "Show exactly 2 identical small red apples grouped together in the middle of the image.",
  "Show a single simple curved arrow pointing from these two groups toward the right side of the image.",
  "On the right side, show exactly 5 identical small red apples grouped together as the combined total.",
  "Use a bright, cheerful, minimal flat cartoon style with a plain, simple, uncluttered background.",
  "Do NOT include any text, numbers, digits, letters, mathematical symbols, or written words anywhere in the image — represent everything using only the apples and the one arrow.",
  "No logos, no brand names, no copyrighted or trademarked characters, no textbook-style borders, headers, or watermarks.",
].join(" ");

async function main() {
  const existing = await prisma.lessonVisualAsset.findUnique({ where: { topicId_stepId: { topicId: TOPIC_ID, stepId: STEP_ID } } });
  if (existing) {
    console.log("A visual asset already exists for this topic/step — refusing to generate a second one. Nothing done.");
    return;
  }

  const topic = await prisma.topic.findUnique({ where: { id: TOPIC_ID } });
  if (!topic) throw new Error("Addition topic not found.");
  const steps = topic.teachingStepsJson;
  const step = steps.find((s) => s.id === STEP_ID);
  if (!step) throw new Error(`Step ${STEP_ID} not found on topic.`);
  if (step.visual?.status === "GENERATED") {
    console.log("Step visual metadata already marked GENERATED — refusing to generate a second one. Nothing done.");
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set in the environment — cannot generate.");

  console.log(`Requesting exactly ONE image generation from OpenAI (${IMAGE_MODEL}, ${IMAGE_QUALITY}, ${IMAGE_SIZE})...`);
  console.log("Prompt:", PROMPT);

  let httpResponse;
  try {
    httpResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: PROMPT,
        size: IMAGE_SIZE,
        quality: IMAGE_QUALITY,
        n: 1,
      }),
    });
  } catch (err) {
    console.error("IMAGE GENERATION FAILED (network error):", err.message);
    console.error("Per instructions: STOPPING here. Do NOT retry automatically. Report this failure before any further attempt.");
    process.exitCode = 1;
    return;
  }

  if (!httpResponse.ok) {
    const errBody = await httpResponse.text().catch(() => "");
    console.error(`IMAGE GENERATION FAILED: HTTP ${httpResponse.status} — ${errBody}`);
    console.error("Per instructions: STOPPING here. Do NOT retry automatically. Report this failure before any further attempt.");
    process.exitCode = 1;
    return;
  }

  const response = await httpResponse.json();
  const imageEntry = response.data?.[0];
  if (!imageEntry) {
    console.error("IMAGE GENERATION returned no image data. STOPPING — no asset stored, no visual marked GENERATED.");
    process.exitCode = 1;
    return;
  }
  const revisedPrompt = imageEntry.revised_prompt ?? null;
  const usage = response.usage ?? null;
  const computedCostUsd = computeCostUsd(usage);
  console.log("Raw usage reported by OpenAI:", JSON.stringify(usage));

  let buffer;
  if (imageEntry.b64_json) {
    buffer = Buffer.from(imageEntry.b64_json, "base64");
  } else if (imageEntry.url) {
    // The API returned a temporary URL (valid ~1 hour) instead of inline
    // data — download it once now so the bytes we persist don't depend on
    // that URL ever staying reachable.
    console.log("API returned a temporary URL; downloading it once now...");
    const imgResp = await fetch(imageEntry.url);
    if (!imgResp.ok) {
      console.error(`Failed to download the generated image from OpenAI's URL: HTTP ${imgResp.status}`);
      process.exitCode = 1;
      return;
    }
    buffer = Buffer.from(await imgResp.arrayBuffer());
  } else {
    console.error("IMAGE GENERATION response had neither b64_json nor url. STOPPING.");
    process.exitCode = 1;
    return;
  }

  const asset = await prisma.lessonVisualAsset.create({
    data: { topicId: TOPIC_ID, stepId: STEP_ID, mimeType: "image/png", data: buffer },
  });

  const updatedSteps = steps.map((s) =>
    s.id === STEP_ID
      ? { ...s, visual: { ...s.visual, status: "GENERATED", url: `/lesson/visuals/${asset.id}` } }
      : s,
  );
  await prisma.topic.update({ where: { id: TOPIC_ID }, data: { teachingStepsJson: updatedSteps } });

  await prisma.aIUsage.create({
    data: {
      userId: ADMIN_USER_ID,
      studentId: null,
      subjectId: null,
      feature: "lesson_visual_generation",
      provider: "openai",
      model: IMAGE_MODEL,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      creditsUsed: 0,
      costUsd: computedCostUsd ?? 0,
    },
  });

  console.log(JSON.stringify({
    assetId: asset.id,
    bytesStored: buffer.length,
    url: `/lesson/visuals/${asset.id}`,
    revisedPromptByModel: revisedPrompt,
    usage,
    costLoggedUsd: computedCostUsd,
  }, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
