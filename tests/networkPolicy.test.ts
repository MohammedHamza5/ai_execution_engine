import { describe, it, expect } from "vitest";
import { applyPlatformNetworkPolicy } from "../src/config/networkPolicy.js";

describe("Platform-Scoped Network Policy (Windows IPv6 / Happy Eyeballs)", () => {
  it("should apply IPv4-first and disable autoSelectFamily when platform is win32", () => {
    const res = applyPlatformNetworkPolicy("win32");
    expect(res.applied).toBe(true);
    expect(res.platform).toBe("win32");
    expect(res.dnsResultOrder).toBe("ipv4first");
    expect(res.autoSelectFamily).toBe(false);
  });

  it("should NOT apply IPv4-first when platform is linux (preserving container RFC 6724 dual-stack)", () => {
    const res = applyPlatformNetworkPolicy("linux");
    expect(res.applied).toBe(false);
    expect(res.platform).toBe("linux");
    expect(res.dnsResultOrder).toBeUndefined();
    expect(res.autoSelectFamily).toBeUndefined();
  });

  it("should NOT apply IPv4-first when platform is darwin (macOS)", () => {
    const res = applyPlatformNetworkPolicy("darwin");
    expect(res.applied).toBe(false);
    expect(res.platform).toBe("darwin");
  });

  it("should evaluate current process platform correctly without errors", () => {
    const res = applyPlatformNetworkPolicy();
    expect(res.platform).toBe(process.platform);
    if (process.platform === "win32") {
      expect(res.applied).toBe(true);
    } else {
      expect(res.applied).toBe(false);
    }
  });
});
