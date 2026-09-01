import { describe, it, expect } from "vitest";
import { checkMemoryContent } from "../MemoryGuard";

describe("checkMemoryContent — spec sections 16, 24 (memory injection / secret storage)", () => {
  it("blocks an sk-style API key", () => {
    expect(checkMemoryContent("here is my key sk-abcdefghijklmnopqrstuvwx").allowed).toBe(false);
  });

  it("blocks a password=value shape", () => {
    expect(checkMemoryContent("password=SuperSecret123!").allowed).toBe(false);
  });

  it("blocks a PEM private key block", () => {
    expect(checkMemoryContent("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...").allowed).toBe(false);
  });

  it("allows an ordinary mention of the word 'password' without a value", () => {
    expect(checkMemoryContent("I need to reset my password tomorrow").allowed).toBe(true);
  });

  it("allows ordinary project/preference content", () => {
    expect(checkMemoryContent("User prefers dark mode and works on Sketchware Neo").allowed).toBe(true);
  });

  it("does not false-positive on casual use of the word 'secret'", () => {
    expect(checkMemoryContent("The secret to good code is testing").allowed).toBe(true);
  });
});
