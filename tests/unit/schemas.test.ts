import { describe, expect, it } from "vitest";
import { transactionSchema } from "@/domain/schemas";

/**
 * O caso que quebrava o formulário de lançamento.
 *
 * Um `<select>` desabilitado não é enviado pelo navegador: a chave nem chega
 * no FormData. Como nenhuma das categorias iniciais tem subcategoria, o campo
 * "Subcategoria" ficava sempre desabilitado, `subcategoryId` sempre faltava, e
 * salvar qualquer lançamento devolvia "Required" num campo que o próprio
 * formulário tinha desabilitado.
 */
const BASE = {
  description: "GOOGLE YOUTUBE",
  date: "2025-11-27",
  invoiceMonth: "2026-01",
  amount: "26,90",
  type: "expense",
  categoryId: "11111111-1111-4111-8111-111111111111",
  memberId: "",
  cardId: "",
  visibility: "shared",
  splitType: "none",
  note: "",
  merchantAlias: "",
  installmentCurrent: "",
  installmentTotal: "",
};

describe("transactionSchema - campos que o navegador não envia", () => {
  it("aceita o formulário sem subcategoria", () => {
    const { subcategoryId: _omitido, ...semSubcategoria } = {
      ...BASE,
      subcategoryId: undefined,
    };
    const result = transactionSchema.safeParse(semSubcategoria);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.subcategoryId).toBeNull();
  });

  it("aceita o formulário sem divisão, que some quando a despesa é individual", () => {
    const { splitType: _omitido, ...semDivisao } = BASE;
    const result = transactionSchema.safeParse({
      ...semDivisao,
      visibility: "individual",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.splitType).toBe("none");
  });

  it("aceita o formulário sem parcela nem cartão", () => {
    const {
      installmentCurrent: _a,
      installmentTotal: _b,
      cardId: _c,
      memberId: _d,
      note: _e,
      merchantAlias: _f,
      ...enxuto
    } = BASE;
    const result = transactionSchema.safeParse(enxuto);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.installmentTotal).toBeNull();
      expect(result.data.cardId).toBeNull();
    }
  });

  it("continua recusando o que é de fato inválido", () => {
    const semDescricao = transactionSchema.safeParse({ ...BASE, description: "" });
    expect(semDescricao.success).toBe(false);

    const categoriaEstranha = transactionSchema.safeParse({
      ...BASE,
      categoryId: "nao-e-uuid",
    });
    expect(categoriaEstranha.success).toBe(false);

    // Subcategoria sem categoria continua sendo erro de verdade.
    const orfa = transactionSchema.safeParse({
      ...BASE,
      categoryId: "",
      subcategoryId: "22222222-2222-4222-8222-222222222222",
    });
    expect(orfa.success).toBe(false);
  });

  it("continua exigindo parcela e total juntos", () => {
    const result = transactionSchema.safeParse({
      ...BASE,
      installmentCurrent: "3",
      installmentTotal: "",
    });
    expect(result.success).toBe(false);
  });
});
