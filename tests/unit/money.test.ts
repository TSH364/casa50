import { describe, expect, it } from "vitest";
import { formatCents, fromCents, parseAmount, parseAmountCents, toCents } from "@/lib/money";

describe("parseAmount - formato brasileiro", () => {
  it("le milhar com ponto e decimal com virgula", () => {
    expect(parseAmount("1.023,73")).toBe(1023.73);
    expect(parseAmount("1.234.567,89")).toBe(1234567.89);
  });

  it("le valores negativos", () => {
    expect(parseAmount("-32,90")).toBe(-32.9);
    expect(parseAmount("32,90-")).toBe(-32.9);
  });

  it("le notacao contabil entre parenteses", () => {
    expect(parseAmount("(32,90)")).toBe(-32.9);
  });

  it("remove o simbolo da moeda e espacos", () => {
    expect(parseAmount("R$ 1.234,56")).toBe(1234.56);
    expect(parseAmount(" R$1.234,56 ")).toBe(1234.56);
    // Espaco nao-quebravel, comum em copia de PDF.
    expect(parseAmount("R$ 1.234,56")).toBe(1234.56);
  });

  it("trata ponto como separador de milhar quando o ultimo grupo tem 3 digitos", () => {
    // Este era o caso que o codigo anterior devolvia como 1.023.
    expect(parseAmount("1.023")).toBe(1023);
    expect(parseAmount("12.500")).toBe(12500);
  });

  it("trata ponto como decimal quando o ultimo grupo nao tem 3 digitos", () => {
    expect(parseAmount("32.90")).toBe(32.9);
    expect(parseAmount("10.5")).toBe(10.5);
  });

  it("le o formato en-US quando ponto e virgula convivem", () => {
    expect(parseAmount("1,023.73")).toBe(1023.73);
  });

  it("aceita numero ja tipado", () => {
    expect(parseAmount(-32.9)).toBe(-32.9);
    expect(parseAmount(0)).toBe(0);
  });

  it("devolve null - e nao zero - para entrada invalida", () => {
    // Zero e um valor legitimo; usa-lo como erro faz a importacao engolir
    // linhas quebradas em silencio.
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount("Desconto")).toBeNull();
    expect(parseAmount("R$")).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
  });

  it("distingue zero de ausencia de valor", () => {
    expect(parseAmount("0,00")).toBe(0);
    expect(parseAmount("0,00")).not.toBeNull();
  });
});

describe("centavos", () => {
  it("converte ida e volta sem perder centavos", () => {
    expect(toCents(1023.73)).toBe(102373);
    expect(fromCents(102373)).toBe(1023.73);
  });

  it("evita o erro de ponto flutuante ao somar", () => {
    // 0.1 + 0.2 === 0.30000000000000004 em float.
    const soma = toCents(0.1) + toCents(0.2);
    expect(soma).toBe(30);
    expect(fromCents(soma)).toBe(0.3);
  });

  it("arredonda meio para cima", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(2.675)).toBe(268);
  });

  it("parseAmountCents combina leitura e conversao", () => {
    expect(parseAmountCents("1.023,73")).toBe(102373);
    expect(parseAmountCents("lixo")).toBeNull();
  });
});

describe("formatCents", () => {
  it("formata em real brasileiro", () => {
    //   e o espaco nao-quebravel que o Intl insere apos "R$".
    expect(formatCents(102373).replace(/ /g, " ")).toBe("R$ 1.023,73");
    expect(formatCents(-3290).replace(/ /g, " ")).toBe("-R$ 32,90");
  });
});
