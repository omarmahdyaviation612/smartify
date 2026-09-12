/**
 * Prepares an AI Tutor reply for text-to-speech. TTS engines (OpenAI's
 * included) read literal characters, not Markdown — left unstripped,
 * "**word**" is spoken as "asterisk asterisk word asterisk asterisk" and a
 * list item like "1. **Soil type:** ..." gets read as a bare "one" with
 * the actual explanation garbled or dropped. This never truncates content;
 * it only removes decoration and turns line breaks into spoken pauses so
 * the full response — including every numbered/bulleted item — is read in
 * order.
 */
export function stripMarkdownForSpeech(markdown: string): string {
  let text = markdown;

  // Fenced and inline code: drop the backticks but keep the text inside —
  // better read aloud than silently vanish.
  text = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, " ").trim());
  text = text.replace(/`([^`]+)`/g, "$1");

  // Markdown links [text](url) -> text; bare autolinks dropped entirely.
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/<https?:\/\/[^\s>]+>/g, "");

  // Headings: "# Heading" / "## Heading" -> "Heading"
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // Bold before italic so "**x**" never leaves stray single "*" behind.
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, "$1");

  // Numbered list markers ("1. " / "2) ") and bullet markers ("- "/"* "/"• ")
  // at the start of a line — removed entirely rather than spoken as "one".
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/^\s*[-*•]\s+/gm, "");

  // Blockquote markers.
  text = text.replace(/^\s{0,3}>\s?/gm, "");

  // Turn line breaks into spoken pauses (a period) rather than losing the
  // boundary between list items/paragraphs entirely.
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(". ");

  // Tidy up doubled punctuation/whitespace introduced by the joins above.
  text = text.replace(/\.\s*\./g, ".").replace(/[ \t]{2,}/g, " ").trim();

  return text;
}
