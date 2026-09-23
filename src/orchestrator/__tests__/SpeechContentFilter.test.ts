import { describe, it, expect } from "vitest";
import { extractSpeechText } from "../SpeechContentFilter";

const JAVA_CALCULATOR = `Here you go — a simple calculator in Java:

\`\`\`java
public class Calculator {
    public static void main(String[] args) {
        System.out.println(add(2, 3));
    }
    static int add(int a, int b) { return a + b; }
}
\`\`\`
`;

describe("extractSpeechText — Phase 3 smart TTS filter", () => {
  it("matches the spec's own example: code-only reply becomes a concise natural pointer", () => {
    const result = extractSpeechText(JAVA_CALCULATOR);
    expect(result.strippedKind).toBe("java code");
    expect(result.speechText.toLowerCase()).not.toContain("public class");
    expect(result.speechText.toLowerCase()).not.toContain("system.out");
    expect(result.speechText).toMatch(/on screen/i);
  });

  it("returns short plain prose completely unchanged", () => {
    const text = "The weather in Saharsa today is sunny with a high of 30°C.";
    const result = extractSpeechText(text);
    expect(result.speechText).toBe(text);
    expect(result.strippedSomething).toBe(false);
  });

  it("keeps real prose alongside a stripped code block and adds a pointer to the full code", () => {
    const result = extractSpeechText(JAVA_CALCULATOR);
    expect(result.speechText).toMatch(/here you go/i);
  });

  it("strips a fenced JSON block", () => {
    const text = "Sure, here's the config:\n```json\n" + JSON.stringify({ a: 1, b: [1, 2, 3], c: "x".repeat(300) }) + "\n```";
    const result = extractSpeechText(text);
    expect(result.speechText).not.toContain("{");
    expect(result.speechText.toLowerCase()).toContain("here's the config");
  });

  it("strips stack-trace-shaped lines", () => {
    const text = [
      "The error was:",
      "Traceback (most recent call last):",
      '  File "app.py", line 10, in <module>',
      "    raise ValueError('bad input')",
      "ValueError: bad input",
    ].join("\n");
    const result = extractSpeechText(text);
    expect(result.speechText).not.toMatch(/Traceback/);
    expect(result.speechText.toLowerCase()).toContain("the error was");
  });

  it("replaces a huge URL with a short phrase instead of reading it character by character", () => {
    const longUrl = "https://example.com/" + "a".repeat(80) + "?token=verylongtoken12345";
    const text = `You can find it here: ${longUrl}`;
    const result = extractSpeechText(text);
    expect(result.speechText).not.toContain(longUrl);
    expect(result.speechText).toContain("a link");
  });

  it("strips a large markdown table", () => {
    const rows = Array.from({ length: 8 }, (_, i) => `| Row ${i} | Value ${i} |`).join("\n");
    const text = `Here are the results:\n\n| Name | Value |\n| --- | --- |\n${rows}`;
    const result = extractSpeechText(text);
    expect(result.speechText).not.toContain("| Row");
    expect(result.strippedKind).toBe("table");
  });

  it("caps very long surviving prose on a word boundary and says the rest is on screen", () => {
    const longProse = "This is a detailed explanation. ".repeat(40);
    const result = extractSpeechText(longProse, 200);
    expect(result.speechText.length).toBeLessThan(230);
    expect(result.speechText).toMatch(/on screen/);
    // Must not cut mid-word.
    expect(result.speechText).not.toMatch(/\w…/);
  });

  it("never truncates random characters out of code — the block is removed as a whole, not mid-token", () => {
    const result = extractSpeechText(JAVA_CALCULATOR);
    expect(result.speechText).not.toMatch(/public class|System\.out|static int/i);
  });

  it("returns an empty string for empty input", () => {
    expect(extractSpeechText("").speechText).toBe("");
    expect(extractSpeechText("   ").speechText).toBe("");
  });

  it("falls back to a generic truthful pointer when nothing identifiable survives and no kind was detected", () => {
    const veryLongSingleLine = "x".repeat(400);
    const result = extractSpeechText(veryLongSingleLine);
    expect(result.speechText).toMatch(/on screen/i);
  });
});
