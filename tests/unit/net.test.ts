import { describe, expect, it } from "vitest";
import { isBlockedHost } from "@/lib/net";

describe("isBlockedHost", () => {
  it("deixa passar host público", () => {
    expect(isBlockedHost("calendar.google.com")).toBe(false);
    expect(isBlockedHost("outlook.office365.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isBlockedHost("172.15.0.1")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false);
  });

  it("barra o que aponta para dentro", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "impressora.local",
      "banco.internal",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.9",
      "172.31.255.254",
      "0.0.0.0",
      "239.1.1.1",
      "::1",
      "[::1]",
      "fd00:1234::1",
      "fe80::1",
    ]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });

  it("barra o endereço de metadados da nuvem", () => {
    // O alvo clássico de SSRF: credenciais da instância.
    expect(isBlockedHost("169.254.169.254")).toBe(true);
  });

  it("não se deixa enganar por maiúsculas", () => {
    expect(isBlockedHost("LocalHost")).toBe(true);
    expect(isBlockedHost("SERVIDOR.Internal")).toBe(true);
  });
});
