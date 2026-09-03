import { describe, expect, it } from "vitest";
import {
  classifyType,
  detectColumns,
  detectSignConvention,
  duplicateKey,
  extractInstallment,
  monthFromDates,
  monthFromFilename,
  categoryFromHint,
  normalizeMerchant,
  parseCardLastFour,
  parseInstallmentCell,
} from "@/importers/detect";
import { parseCsv, parseDate } from "@/importers/parse";

describe("normalizeMerchant", () => {
  it("converge as variações do mesmo estabelecimento", () => {
    // O caso da secao 14: três grafias, um estabelecimento.
    expect(normalizeMerchant("PG *99 RIDE")).toBe("99 RIDE");
    expect(normalizeMerchant("DL*99 RIDE")).toBe("99 RIDE");
    expect(normalizeMerchant("99 Ride")).toBe("99 RIDE");
  });

  it("remove o sufixo de parcela", () => {
    expect(normalizeMerchant("MAGAZINE LUIZA 3/10")).toBe("MAGAZINE LUIZA");
    expect(normalizeMerchant("MAGAZINE LUIZA - Parcela 3/10")).toBe("MAGAZINE LUIZA");
  });

  it("remove acentos e pontuação", () => {
    expect(normalizeMerchant("Padaria São José")).toBe("PADARIA SAO JOSE");
    expect(normalizeMerchant("MERCADO  ---  X")).toBe("MERCADO X");
  });

  it("não confunde prefixo com início de palavra", () => {
    // "PGTO" é prefixo de adquirente, mas "PAGUE MENOS" não deve perder letra.
    expect(normalizeMerchant("PAGUE MENOS")).toBe("PAGUE MENOS");
  });
});

describe("extractInstallment", () => {
  it("lê a parcela da descrição", () => {
    expect(extractInstallment("NETFLIX 3/12")).toEqual({ current: 3, total: 12 });
    expect(extractInstallment("LOJA - Parcela 1/6")).toEqual({ current: 1, total: 6 });
  });

  it("ignora quando não há parcela", () => {
    expect(extractInstallment("MERCADO")).toBeNull();
  });

  it("não confunde data com parcela", () => {
    // 12/2026 tem "atual" maior que "total" - não é parcela.
    expect(extractInstallment("COMPRA 12/2026")).toBeNull();
    expect(extractInstallment("SEGURO 13/12")).toBeNull();
  });
});

describe("monthFromFilename", () => {
  it("lê o formato ISO", () => {
    expect(monthFromFilename("Nubank_2026-08.csv")).toBe("2026-08");
    expect(monthFromFilename("nubank-2026-08-12.csv")).toBe("2026-08");
  });

  it("lê o formato brasileiro", () => {
    expect(monthFromFilename("fatura_08-2026.csv")).toBe("2026-08");
  });

  it("lê o nome do mês em português", () => {
    expect(monthFromFilename("fatura-agosto-2026.csv")).toBe("2026-08");
    expect(monthFromFilename("ago_2026.csv")).toBe("2026-08");
    expect(monthFromFilename("fatura-marco-2026.xlsx")).toBe("2026-03");
  });

  it("lê o formato compacto", () => {
    expect(monthFromFilename("nubank202608.csv")).toBe("2026-08");
  });

  it("devolve null quando não há mês no nome", () => {
    // Melhor pedir o mês ao usuário do que chutar.
    expect(monthFromFilename("fatura.csv")).toBeNull();
    expect(monthFromFilename("extrato-final.csv")).toBeNull();
  });

  it("não aceita mês inválido", () => {
    expect(monthFromFilename("arquivo-2026-13.csv")).toBeNull();
  });
});

describe("monthFromFilename - vencimento colado", () => {
  it("lê o nome que o Itaú dá ao arquivo", () => {
    // "Fatura_20260105" é a data de vencimento: fatura de janeiro de 2026.
    // Sem este caso o mês vinha das datas de compra (dezembro), um mês atrás.
    expect(monthFromFilename("Fatura_20260105.csv")).toBe("2026-01");
    expect(monthFromFilename("Fatura_20260812.csv")).toBe("2026-08");
  });

  it("continua lendo o formato de seis dígitos", () => {
    expect(monthFromFilename("fatura_202608.csv")).toBe("2026-08");
  });
});

describe("monthFromDates", () => {
  it("escolhe o mês mais frequente", () => {
    expect(
      monthFromDates(["2026-08-01", "2026-08-20", "2026-07-30"]),
    ).toBe("2026-08");
  });

  it("devolve null sem datas válidas", () => {
    expect(monthFromDates([])).toBeNull();
  });
});

describe("parseDate", () => {
  it("lê ISO e brasileiro", () => {
    expect(parseDate("2026-08-12")).toBe("2026-08-12");
    expect(parseDate("12/08/2026")).toBe("2026-08-12");
    expect(parseDate("12-08-26")).toBe("2026-08-12");
  });

  it("rejeita data impossível", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("lixo")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("detectColumns", () => {
  it("reconhece o cabeçalho do Nubank", () => {
    const map = detectColumns(["date", "title", "amount"]);
    expect(map.date).toBe("date");
    expect(map.description).toBe("title");
    expect(map.amount).toBe("amount");
  });

  it("reconhece cabeçalho em português", () => {
    const map = detectColumns(["Data", "Descrição", "Valor", "Categoria"]);
    expect(map.date).toBe("Data");
    expect(map.description).toBe("Descrição");
    expect(map.amount).toBe("Valor");
    expect(map.category).toBe("Categoria");
  });

  it("prefere o valor em real ao valor em dólar", () => {
    // O caso que zerava a fatura do Itaú: as duas colunas começam com "valor"
    // e a de dólar vem primeiro. Em compra nacional ela é 0.
    const map = detectColumns([
      "Data de Compra",
      "Nome no Cartão",
      "Final do Cartão",
      "Categoria",
      "Descrição",
      "Parcela",
      "Valor (em US$)",
      "Cotação (em R$)",
      "Valor (em R$)",
    ]);
    expect(map.amount).toBe("Valor (em R$)");
    expect(map.date).toBe("Data de Compra");
    expect(map.description).toBe("Descrição");
    expect(map.installment).toBe("Parcela");
    expect(map.card).toBe("Final do Cartão");
  });

  it("nunca confunde a cotação com o valor", () => {
    const map = detectColumns(["Data", "Descrição", "Cotação (em R$)", "Valor"]);
    expect(map.amount).toBe("Valor");
  });

  it("aceita a coluna em dólar quando é a única que existe", () => {
    // Ficar sem coluna de valor seria pior: melhor ler e deixar conferir.
    const map = detectColumns(["Data", "Descrição", "Valor (em US$)"]);
    expect(map.amount).toBe("Valor (em US$)");
  });

  it("não confunde o nome do titular com o final do cartão", () => {
    const map = detectColumns(["Data", "Nome no Cartão", "Descrição", "Valor"]);
    expect(map.card).toBeNull();
  });
});

describe("parseInstallmentCell", () => {
  it("lê a parcela da coluna dedicada", () => {
    expect(parseInstallmentCell("2/12")).toEqual({ current: 2, total: 12 });
    expect(parseInstallmentCell("2 de 12")).toEqual({ current: 2, total: 12 });
  });

  it("trata compra à vista como sem parcela", () => {
    expect(parseInstallmentCell("Única")).toBeNull();
    expect(parseInstallmentCell("À vista")).toBeNull();
    expect(parseInstallmentCell("-")).toBeNull();
    expect(parseInstallmentCell("")).toBeNull();
  });

  it("ignora parcela impossível", () => {
    expect(parseInstallmentCell("13/12")).toBeNull();
  });

  it("não lê uma data como parcela", () => {
    expect(parseInstallmentCell("12/2026")).toBeNull();
  });

  it("aceita a palavra 'parcela' antes do número", () => {
    expect(parseInstallmentCell("Parcela 3/6")).toEqual({ current: 3, total: 6 });
  });
});

describe("parseCardLastFour", () => {
  it("lê os quatro últimos dígitos", () => {
    expect(parseCardLastFour("2150")).toBe("2150");
    expect(parseCardLastFour("**** 6869")).toBe("6869");
    expect(parseCardLastFour("0162")).toBe("0162");
  });

  it("devolve nulo quando não há número de cartão", () => {
    expect(parseCardLastFour("VINICIUS ROSELLI")).toBeNull();
    expect(parseCardLastFour("")).toBeNull();
  });
});

describe("detectSignConvention", () => {
  it("assume despesa positiva quando a maioria é positiva", () => {
    // Formato real do Nubank: despesa positiva, pagamento negativo.
    expect(detectSignConvention([32.9, 18.4, 412.77, -1500])).toBe(
      "expense_positive",
    );
  });

  it("assume despesa negativa quando a maioria é negativa", () => {
    // Convenção do exemplo da especificação.
    expect(detectSignConvention([-32.9, -18.4, -412.77, 1500])).toBe(
      "expense_negative",
    );
  });

  it("cai no formato do Nubank quando não há sinal dominante", () => {
    expect(detectSignConvention([])).toBe("expense_positive");
    expect(detectSignConvention([10, -10])).toBe("expense_positive");
  });
});

describe("classifyType", () => {
  const positivo = "expense_positive" as const;

  it("classifica despesa comum", () => {
    expect(classifyType("PG *99 RIDE", 32.9, positivo)).toBe("expense");
  });

  it("separa tarifas do cartão", () => {
    expect(classifyType("Anuidade diferenciada", 40, positivo)).toBe("fee");
    expect(classifyType("IOF de transação internacional", 3.2, positivo)).toBe("fee");
    expect(classifyType("Juros de atraso", 12, positivo)).toBe("fee");
  });

  it("reconhece pagamento de fatura", () => {
    expect(classifyType("Pagamento recebido", -1500, positivo)).toBe("payment");
  });

  it("reconhece estorno", () => {
    expect(classifyType("Estorno de ZE DELIVERY", -89.9, positivo)).toBe("refund");
  });

  it('não trata "Desconto" como pagamento', () => {
    // Exigência explícita da secao 6: "Desconto" aparece como categoria em
    // alguns exports e não pode virar quitação de fatura - vira estorno,
    // que abate a despesa em vez de sumir da conta.
    expect(classifyType("Desconto Antecipação", -15, positivo)).toBe("refund");
    expect(classifyType("Desconto", -15, positivo)).not.toBe("payment");
  });

  it("respeita a convenção invertida", () => {
    const negativo = "expense_negative" as const;
    expect(classifyType("PG *99 RIDE", -32.9, negativo)).toBe("expense");
    expect(classifyType("Pagamento recebido", 1500, negativo)).toBe("payment");
  });
});

describe("classifyType - casos da fatura do Itaú", () => {
  it("reconhece a quitação da fatura anterior", () => {
    expect(
      classifyType("Inclusao de Pagamento    ", -18151.91, "expense_positive"),
    ).toBe("payment");
  });

  it("trata valor zero como cobrança, não como estorno", () => {
    // Zero não tem lado. Antes caía em `refund` porque não era "> 0".
    expect(classifyType("GOOGLE YOUTUBE", 0, "expense_positive")).toBe("expense");
    expect(classifyType("Anuidade", 0, "expense_positive")).toBe("fee");
    expect(classifyType("Estorno de tarifa", 0, "expense_positive")).toBe("refund");
  });
});

describe("duplicateKey", () => {
  const base = {
    date: "2026-08-12",
    merchantNormalized: "NETFLIX",
    amountCents: 5590,
  };

  it("é igual para o mesmo lançamento", () => {
    expect(duplicateKey({ ...base, invoiceMonth: "2026-08" })).toBe(
      duplicateKey({ ...base, invoiceMonth: "2026-08" }),
    );
  });

  it("difere entre meses - a mesma assinatura repete legitimamente", () => {
    // Regra central da secao 6: nunca colapsar compras de faturas diferentes.
    expect(duplicateKey({ ...base, invoiceMonth: "2026-08" })).not.toBe(
      duplicateKey({ ...base, invoiceMonth: "2026-09" }),
    );
  });

  it("difere entre parcelas da mesma compra", () => {
    const a = duplicateKey({
      ...base,
      invoiceMonth: "2026-08",
      installmentCurrent: 3,
      installmentTotal: 10,
    });
    const b = duplicateKey({
      ...base,
      invoiceMonth: "2026-08",
      installmentCurrent: 4,
      installmentTotal: 10,
    });
    expect(a).not.toBe(b);
  });

  it("difere entre cartões", () => {
    expect(
      duplicateKey({ ...base, invoiceMonth: "2026-08", cardId: "nubank" }),
    ).not.toBe(duplicateKey({ ...base, invoiceMonth: "2026-08", cardId: "itau" }));
  });

  it("é igual para duas linhas idênticas na mesma fatura", () => {
    // Duas corridas iguais no mesmo dia: legítimo, mas precisa ser sinalizado
    // na revisão para o casal decidir.
    const a = duplicateKey({ ...base, invoiceMonth: "2026-08" });
    const b = duplicateKey({ ...base, invoiceMonth: "2026-08" });
    expect(a).toBe(b);
  });
});

describe("parseCsv - formato Nubank", () => {
  const CSV = [
    "date,title,amount",
    '2026-08-12,PG *99 RIDE,"32,90"',
    '2026-08-14,PAO DE ACUCAR,"1.023,73"',
    '2026-08-20,NETFLIX.COM 3/12,"55,90"',
    '2026-08-09,Pagamento recebido,"-1.500,00"',
    '2026-08-13,Estorno de ZE DELIVERY,"-89,90"',
  ].join("\n");

  const result = parseCsv(CSV, { fileName: "Nubank_2026-08.csv" });

  it("identifica as colunas do Nubank", () => {
    expect(result.columns.date).toBe("date");
    expect(result.columns.description).toBe("title");
    expect(result.columns.amount).toBe("amount");
  });

  it("lê todas as linhas", () => {
    expect(result.drafts).toHaveLength(5);
    expect(result.issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("interpreta valores brasileiros", () => {
    expect(result.drafts[0]?.amountCents).toBe(3290);
    expect(result.drafts[1]?.amountCents).toBe(102373);
  });

  it("guarda o valor sempre positivo, com o sinal no tipo", () => {
    const pagamento = result.drafts.find((d) => d.type === "payment");
    expect(pagamento?.amountCents).toBe(150000);
    expect(pagamento?.amountCents).toBeGreaterThan(0);
  });

  it("detecta a convenção de sinal do arquivo", () => {
    expect(result.signConvention).toBe("expense_positive");
  });

  it("classifica cada tipo", () => {
    const tipos = result.drafts.map((d) => d.type);
    expect(tipos).toContain("expense");
    expect(tipos).toContain("payment");
    expect(tipos).toContain("refund");
  });

  it("pega o mês pelo nome do arquivo", () => {
    expect(result.detectedMonth).toBe("2026-08");
    expect(result.monthSource).toBe("filename");
    expect(result.drafts.every((d) => d.invoiceMonth === "2026-08")).toBe(true);
  });

  it("extrai a parcela da descrição", () => {
    const netflix = result.drafts.find((d) => d.description.includes("NETFLIX"));
    expect(netflix?.installmentCurrent).toBe(3);
    expect(netflix?.installmentTotal).toBe(12);
  });

  it("normaliza o estabelecimento", () => {
    expect(result.drafts[0]?.merchantNormalized).toBe("99 RIDE");
    expect(result.drafts[2]?.merchantNormalized).toBe("NETFLIX COM");
  });

  it("reconhece a instituição pelo nome do arquivo", () => {
    expect(result.institution).toBe("Nubank");
  });
});

describe("parseCsv - convenção invertida", () => {
  it("lê o formato do exemplo da especificação", () => {
    // Aqui a despesa vem negativa - o oposto do arquivo real do Nubank.
    const csv = [
      "date,title,amount",
      '2026-08-12,PG *99 RIDE,"-32,90"',
      '2026-08-14,MERCADO,"-120,00"',
      '2026-08-09,Pagamento recebido,"1.500,00"',
    ].join("\n");
    const result = parseCsv(csv, { fileName: "fatura-2026-08.csv" });

    expect(result.signConvention).toBe("expense_negative");
    expect(result.drafts[0]?.type).toBe("expense");
    expect(result.drafts[0]?.amountCents).toBe(3290);
    expect(result.drafts[2]?.type).toBe("payment");
  });

  it("aceita a convenção forçada pelo usuário", () => {
    const csv = ["date,title,amount", '2026-08-12,LOJA,"32,90"'].join("\n");
    const result = parseCsv(csv, {
      fileName: "f-2026-08.csv",
      signConvention: "expense_negative",
    });
    // Com a convenção invertida, um valor positivo deixa de ser despesa.
    expect(result.drafts[0]?.type).toBe("refund");
  });
});

describe("parseCsv - dados problemáticos", () => {
  it("ignora a linha e avisa quando o valor não é legível", () => {
    const csv = [
      "date,title,amount",
      '2026-08-12,LOJA A,"32,90"',
      "2026-08-13,LOJA B,ilegivel",
    ].join("\n");
    const result = parseCsv(csv, { fileName: "f-2026-08.csv" });

    expect(result.drafts).toHaveLength(1);
    expect(result.issues.some((i) => i.message.includes("Valor não reconhecido"))).toBe(true);
  });

  it("ignora a linha e avisa quando a data não é legível", () => {
    const csv = ["date,title,amount", '32 de agosto,LOJA,"10,00"'].join("\n");
    const result = parseCsv(csv, { fileName: "f-2026-08.csv" });

    expect(result.drafts).toHaveLength(0);
    expect(result.issues.some((i) => i.message.includes("Data não reconhecida"))).toBe(true);
  });

  it("reclama quando falta uma coluna essencial", () => {
    const csv = ["data,observacao", "2026-08-12,qualquer coisa"].join("\n");
    const result = parseCsv(csv, { fileName: "f-2026-08.csv" });

    expect(result.drafts).toHaveLength(0);
    expect(result.issues.some((i) => i.level === "error")).toBe(true);
  });

  it("erra explicitamente quando não dá para saber o mês", () => {
    // Sem mês no nome e sem data válida: pedir, nunca chutar.
    const csv = ["date,title,amount", "sem data,LOJA,10"].join("\n");
    const result = parseCsv(csv, { fileName: "fatura.csv" });

    expect(result.detectedMonth).toBeNull();
    expect(result.issues.some((i) => i.level === "error")).toBe(true);
  });

  it("usa a coluna de categoria só como dica, sem virar tipo", () => {
    const csv = [
      "date,category,title,amount",
      '2026-08-12,Desconto,Ajuste da loja,"-15,00"',
    ].join("\n");
    const result = parseCsv(csv, { fileName: "f-2026-08.csv" });

    expect(result.drafts[0]?.categoryHint).toBe("Desconto");
    expect(result.drafts[0]?.type).not.toBe("payment");
  });

  it("respeita o mês confirmado pelo usuário acima da detecção", () => {
    const csv = ["date,title,amount", '2026-08-12,LOJA,"10,00"'].join("\n");
    const result = parseCsv(csv, {
      fileName: "Nubank_2026-08.csv",
      invoiceMonth: "2026-09",
    });
    expect(result.drafts[0]?.invoiceMonth).toBe("2026-09");
  });
});

describe("parseCsv - formato Itaú (fatura que vinha zerada)", () => {
  // Recorte fiel do CSV real: separador ";", duas colunas de valor, coluna de
  // parcela e final do cartão próprios. Antes da correção, o importador pegava
  // "Valor (em US$)" e as 96 linhas entravam como R$ 0,00.
  const CSV = [
    "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)",
    "27/11/2025;VINICIUS ROSELLI;2150;Empresa serviços;GOOGLE YOUTUBE;Única;0;0;26.90",
    "03/12/2025;VINICIUS ROSELLI;2150;Elétrico;OPENAI *CHATGPT SUBSCR SA;Única;20.00;5.63;112.53",
    "14/10/2025;VINICIUS ROSELLI;6869;Educacional;ADAPTAORG;2/12;0;0;99.00",
    '05/12/2025;VINICIUS ROSELLI;6869;-;"Inclusao de Pagamento    ";Única;0;0;-18151.91',
    "23/12/2025;VINICIUS ROSELLI;6869;-;Anuidade Diferenciada;12/12;0;0;98.00",
    "23/12/2025;VINICIUS ROSELLI;6869;-;Estorno Tarifa;Única;0;0;-98.00",
    "04/06/2025;VINICIUS ROSELLI;0162;Transporte;AIRBNB * HMKHDBT8PZ;7/7;0;0;2163.58",
  ].join("\n");

  const result = parseCsv(CSV, { fileName: "Fatura_20260105.csv" });

  it("lê o valor em real, não o valor em dólar", () => {
    expect(result.columns.amount).toBe("Valor (em R$)");
    expect(result.drafts[0]?.amountCents).toBe(2690);
    // A compra internacional tem os dois valores; vale o convertido.
    expect(result.drafts[1]?.amountCents).toBe(11253);
    expect(result.drafts.every((d) => d.amountCents !== 0)).toBe(true);
    expect(result.issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("lê todas as linhas do arquivo separado por ponto e vírgula", () => {
    expect(result.drafts).toHaveLength(7);
  });

  it("tira o mês do vencimento no nome do arquivo", () => {
    // As compras são de outubro a dezembro, mas a fatura é a de janeiro.
    expect(result.detectedMonth).toBe("2026-01");
    expect(result.monthSource).toBe("filename");
  });

  it("lê a parcela da coluna própria, que a descrição não traz", () => {
    const adapta = result.drafts.find((d) => d.description === "ADAPTAORG");
    expect(adapta?.installmentCurrent).toBe(2);
    expect(adapta?.installmentTotal).toBe(12);

    const youtube = result.drafts[0];
    expect(youtube?.installmentTotal).toBeNull();
  });

  it("guarda o final do cartão de cada linha", () => {
    expect(result.columns.card).toBe("Final do Cartão");
    expect([...new Set(result.drafts.map((d) => d.cardLastFour))]).toEqual([
      "2150",
      "6869",
      "0162",
    ]);
  });

  it("classifica pagamento, tarifa e estorno da fatura", () => {
    const byDescription = new Map(result.drafts.map((d) => [d.description, d]));
    expect(byDescription.get("Inclusao de Pagamento")?.type).toBe("payment");
    expect(byDescription.get("Anuidade Diferenciada")?.type).toBe("fee");
    expect(byDescription.get("Estorno Tarifa")?.type).toBe("refund");
    expect(byDescription.get("GOOGLE YOUTUBE")?.type).toBe("expense");
  });

  it("guarda o valor positivo mesmo quando o arquivo traz negativo", () => {
    const pagamento = result.drafts.find((d) => d.type === "payment");
    expect(pagamento?.amountCents).toBe(1815191);
  });

  it("usa a categoria do banco só como dica", () => {
    expect(result.drafts[0]?.categoryHint).toBe("Empresa serviços");
  });

  it("aceita a coluna de valor escolhida à mão", () => {
    const forced = parseCsv(CSV, {
      fileName: "Fatura_20260105.csv",
      columns: { amount: "Valor (em US$)" },
    });
    expect(forced.drafts[1]?.amountCents).toBe(2000);
  });
});

describe("parseCsv - fatura toda zerada", () => {
  it("recusa em vez de gravar dezenas de lançamentos de R$ 0,00", () => {
    const csv = [
      "Data;Descrição;Valor (em US$)",
      "27/11/2025;GOOGLE YOUTUBE;0",
      "29/11/2025;POSTO NATURAFLEX;0",
    ].join("\n");
    const result = parseCsv(csv, { fileName: "Fatura_20260105.csv" });

    const erros = result.issues.filter((i) => i.level === "error");
    expect(erros).toHaveLength(1);
    expect(erros[0]?.message).toContain("Valor (em US$)");
  });

  it("não reclama de uma única linha zerada no meio de uma fatura normal", () => {
    const csv = [
      "Data;Descrição;Valor",
      "27/11/2025;LOJA A;0",
      "29/11/2025;LOJA B;120,00",
    ].join("\n");
    const result = parseCsv(csv, { fileName: "Fatura_20260105.csv" });

    expect(result.issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(result.drafts[0]?.type).toBe("expense");
  });
});

describe("categoryFromHint", () => {
  it("traduz o vocabulário do Itaú para as categorias da casa", () => {
    // Nenhum destes casava por nome exato, e por isso a fatura inteira
    // entrava sem categoria.
    expect(categoryFromHint("Restaurante / Lanchonete / Bar")).toBe("Alimentacao");
    expect(
      categoryFromHint(
        "Supermercados / Mercearia / Padarias / Lojas de Conveniência",
      ),
    ).toBe("Alimentacao");
    expect(categoryFromHint("Relacionados a Automotivo")).toBe("Transporte");
    expect(categoryFromHint("Assistência médica e odontológica")).toBe("Saude");
    expect(categoryFromHint("Educacional")).toBe("Educacao");
    expect(categoryFromHint("Entretenimento")).toBe("Lazer");
    expect(categoryFromHint("Especialidade varejo")).toBe("Compras");
    expect(categoryFromHint("Casa / Escritório Mobiliário")).toBe("Moradia");
    expect(categoryFromHint("Empresa serviços")).toBe("Servicos");
  });

  it("prefere a regra específica à genérica", () => {
    // "Serviços de telecomunicações" também casaria com "servico".
    expect(categoryFromHint("Serviços de telecomunicações")).toBe("Servicos");
    expect(categoryFromHint("TV por assinatura / Serviços de rádio")).toBe(
      "Assinaturas",
    );
  });

  it("não inventa categoria para o que não reconhece", () => {
    expect(categoryFromHint("-")).toBeNull();
    expect(categoryFromHint("")).toBeNull();
    expect(categoryFromHint("Categoria que não existe")).toBeNull();
  });
});
