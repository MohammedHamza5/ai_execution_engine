import dns from "node:dns";
import net from "node:net";

export interface NetworkPolicyResult {
  readonly applied: boolean;
  readonly platform: NodeJS.Platform;
  readonly dnsResultOrder?: "ipv4first" | "verbatim";
  readonly autoSelectFamily?: boolean;
}

let isPatched = false;

/**
 * Applies platform-scoped network policy.
 * 
 * On Windows (win32), Node.js dual-stack Happy Eyeballs autoSelectFamily algorithm
 * attempts unrouted IPv6 interfaces, hanging on socket connection (ETIMEDOUT / ENETUNREACH).
 * Constraining dns resolution to IPv4 (family: 4) prevents undici and socket hangs.
 * 
 * On Linux, macOS, and containerized cloud environments, dual-stack resolution is left
 * untouched to preserve native RFC 6724 IPv6 routing.
 * Operating system network settings are never modified.
 */
export function applyPlatformNetworkPolicy(platformOverride?: NodeJS.Platform): NetworkPolicyResult {
  const currentPlatform = platformOverride ?? process.platform;

  if (currentPlatform === "win32") {
    dns.setDefaultResultOrder("ipv4first");
    if (typeof net.setDefaultAutoSelectFamily === "function") {
      net.setDefaultAutoSelectFamily(false);
    }

    if (!isPatched && !platformOverride) {
      const originalLookup = dns.lookup;
      (dns as any).lookup = function (hostname: string, options: any, callback: any) {
        if (typeof options === "function") {
          callback = options;
          options = {};
        } else if (typeof options === "number") {
          options = { family: options };
        }
        const opts = typeof options === "object" && options !== null ? { ...options } : {};
        opts.family = 4;
        return (originalLookup as any).call(dns, hostname, opts, callback);
      };
      isPatched = true;
    }

    return {
      applied: true,
      platform: currentPlatform,
      dnsResultOrder: "ipv4first",
      autoSelectFamily: false,
    };
  }

  return {
    applied: false,
    platform: currentPlatform,
  };
}
