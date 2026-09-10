import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  costByKind,
  dailyBaselineCents,
  eventDays,
  eventDaysInMonth,
  eventsInMonth,
  monthPressure,
  spendDuringEvents,
  type CalendarEvent,
} from "@/domain/calendar";
import type { Transaction } from "@/domain/types";

let contador = 0;

function tx(overrides: Partial<Transaction> = {}): Transaction {
  contador += 1;
  const date = overrides.date ?? "2026-08-10";
  return {
    id: `t${contador}`,
    houseId: "casa",
    invoiceId: null,
    cardId: null,
    memberId: null,
    date,
    description: "COMPRA",
    merchantOriginal: null,
    merchantNormalized: "COMPRA",
    merchantAlias: null,
    amount: 100,
    currency: "BRL",
    originalAmount: null,
    originalCurrency: null,
    type: "expense",
    origin: "manual",
    status: "confirmed",
    categoryId: null,
    subcategoryId: null,
    note: null,
    receiptUrl: null,
    visibility: "shared",
    splitType: "none",
    splitPercentage: null,
    installment: null,
    recurringId: null,
    reconciledWithId: null,
    isHidden: false,
    isReconciled: false,
    createdBy: null,
    createdAt: "2026-08-10T00:00:00Z",
    updatedAt: "2026-08-10T00:00:00Z",
    invoiceMonth: date.slice(0, 7),
    ...overrides,
  };
}

function ev(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const startsOn = overrides.startsOn ?? "2026-08-10";
  return {
    id: overrides.id ?? `e${Math.random().toString(36).slice(2)}`,
    houseId: "casa",
    sourceId: "fonte",
    uid: "uid",
    title: "Evento",
    location: null,
    startsOn,
    endsOn: overrides.endsOn ?? startsOn,
    allDay: true,
    kind: "other",
    ...overrides,
  };
}

/** Enche um mês inteiro de dias sem gasto, para a mediana ter contra o que comparar. */
function mesComum(month: string, dias: number, valor: number): Transaction[] {
  return Array.from({ length: dias }, (_, i) =>
    tx({ date: `${month}-${String(i + 1).padStart(2, "0")}`, amount: valor }),
  );
}

describe("classifyEvent", () => {
  it("reconhece viagem pelo título", () => {
    expect(classifyEvent("Viagem para Paraty")).toBe("trip");
    expect(classifyEvent("Voo GRU → REC")).toBe("trip");
    expect(classifyEvent("Férias")).toBe("trip");
  });

  it("usa o local quando o título não diz nada", () => {
    expect(classifyEvent("Fim de semana")).toBe("other");
    expect(classifyEvent("Fim de semana", "Pousada do Sol")).toBe("trip");
  });

  it("separa comemoração de saúde e de estudo", () => {
    expect(classifyEvent("Aniversário da Larissa")).toBe("celebration");
    expect(classifyEvent("Consulta com a dentista")).toBe("health");
    expect(classifyEvent("Curso de marcenaria")).toBe("education");
    expect(classifyEvent("Reunião de equipe")).toBe("work");
  });

  it("não inventa categoria para título comum", () => {
    expect(classifyEvent("Larissa")).toBe("other");
    // "azul" é palavra comum antes de ser companhia aérea.
    expect(classifyEvent("Comprar camisa azul")).toBe("other");
  });

  it("comemoração vence viagem quando as duas palavras aparecem", () => {
    // A ordem da tabela é a decisão: o jantar é o evento do dia.
    expect(classifyEvent("Jantar de aniversário no hotel")).toBe("celebration");
  });
});

describe("dias do evento", () => {
  it("conta o primeiro e o último dia", () => {
    expect(eventDays({ startsOn: "2026-01-10", endsOn: "2026-01-14" })).toBe(5);
    expect(eventDays({ startsOn: "2026-01-10", endsOn: "2026-01-10" })).toBe(1);
  });

  it("recorta a viagem que atravessa o mês", () => {
    const viagem = { startsOn: "2025-12-28", endsOn: "2026-01-04" };
    expect(eventDaysInMonth(viagem, "2025-12")).toBe(4);
    expect(eventDaysInMonth(viagem, "2026-01")).toBe(4);
    expect(eventDaysInMonth(viagem, "2026-02")).toBe(0);
  });

  it("eventsInMonth traz o que encosta no mês, em ordem", () => {
    const eventos = [
      ev({ id: "b", startsOn: "2026-01-20" }),
      ev({ id: "a", startsOn: "2025-12-30", endsOn: "2026-01-02" }),
      ev({ id: "fora", startsOn: "2026-03-01" }),
    ];
    expect(eventsInMonth(eventos, "2026-01").map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("spendDuringEvents", () => {
  it("soma o que saiu nos dias do evento", () => {
    const viagem = ev({
      id: "viagem",
      kind: "trip",
      startsOn: "2026-08-10",
      endsOn: "2026-08-12",
    });
    const lancamentos = [
      tx({ date: "2026-08-09", amount: 50 }),
      tx({ date: "2026-08-10", amount: 200 }),
      tx({ date: "2026-08-12", amount: 300 }),
      tx({ date: "2026-08-13", amount: 70 }),
    ];

    const [resultado] = spendDuringEvents([viagem], lancamentos);
    expect(resultado?.totalCents).toBe(50_000);
    expect(resultado?.transactions).toHaveLength(2);
    expect(resultado?.days).toBe(3);
  });

  it("cada lançamento serve a um evento só, e o mais específico ganha", () => {
    const viagem = ev({
      id: "viagem",
      kind: "trip",
      startsOn: "2026-08-10",
      endsOn: "2026-08-17",
    });
    const niver = ev({
      id: "niver",
      kind: "celebration",
      startsOn: "2026-08-12",
      endsOn: "2026-08-12",
    });

    const resultado = spendDuringEvents(
      [viagem, niver],
      [tx({ date: "2026-08-12", amount: 400 })],
    );
    const porId = new Map(resultado.map((r) => [r.event.id, r.totalCents]));
    // O evento de um dia é o dono daquele dia.
    expect(porId.get("niver")).toBe(40_000);
    expect(porId.get("viagem")).toBe(0);
  });

  it("ignora lançamento oculto e pagamento de fatura", () => {
    const evento = ev({ startsOn: "2026-08-10", endsOn: "2026-08-10", kind: "trip" });
    const resultado = spendDuringEvents(
      [evento],
      [
        tx({ date: "2026-08-10", amount: 100, isHidden: true }),
        tx({ date: "2026-08-10", amount: 900, type: "payment" }),
        tx({ date: "2026-08-10", amount: 60 }),
      ],
    );
    expect(resultado[0]?.totalCents).toBe(6_000);
  });
});

describe("dailyBaselineCents", () => {
  it("é a mediana do dia sem compromisso, contando dia sem gasto", () => {
    // 31 dias de agosto, 10 deles com R$ 100. A mediana é zero.
    const lancamentos = Array.from({ length: 10 }, (_, i) =>
      tx({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, amount: 100 }),
    );
    expect(dailyBaselineCents(lancamentos, [])).toBe(0);
  });

  it("um dia caro não levanta a linha de base", () => {
    const lancamentos = [
      ...mesComum("2026-08", 31, 50),
      tx({ date: "2026-08-15", amount: 5000 }),
    ];
    // Mediana continua nos R$ 50 do dia comum, não sobe pela anuidade.
    expect(dailyBaselineCents(lancamentos, [])).toBe(5_000);
  });

  it("exclui os dias que já têm compromisso", () => {
    const lancamentos = [
      ...mesComum("2026-08", 31, 50),
      // Cinco dias de viagem, caros.
      ...Array.from({ length: 5 }, (_, i) =>
        tx({ date: `2026-08-${String(i + 10).padStart(2, "0")}`, amount: 400 }),
      ),
    ];
    const viagem = ev({ kind: "trip", startsOn: "2026-08-10", endsOn: "2026-08-14" });
    expect(dailyBaselineCents(lancamentos, [viagem])).toBe(5_000);
  });
});

describe("costByKind", () => {
  const lancamentos = [
    ...mesComum("2026-05", 31, 50),
    ...mesComum("2026-06", 30, 50),
    // Viagem 1: 3 dias, R$ 350/dia em vez de R$ 50.
    ...Array.from({ length: 3 }, (_, i) =>
      tx({ date: `2026-05-${String(i + 10).padStart(2, "0")}`, amount: 300 }),
    ),
    // Viagem 2: 2 dias, mesmo excedente.
    ...Array.from({ length: 2 }, (_, i) =>
      tx({ date: `2026-06-${String(i + 5).padStart(2, "0")}`, amount: 300 }),
    ),
  ];
  const viagens = [
    ev({ id: "v1", kind: "trip", startsOn: "2026-05-10", endsOn: "2026-05-12" }),
    ev({ id: "v2", kind: "trip", startsOn: "2026-06-05", endsOn: "2026-06-06" }),
  ];

  it("aprende o excedente por dia, descontando o dia comum", () => {
    const custos = costByKind(viagens, lancamentos, { today: "2026-07-01" });
    const viagem = custos.get("trip");
    expect(viagem?.sampleSize).toBe(2);
    // R$ 350 no dia da viagem menos R$ 50 do dia comum.
    expect(viagem?.extraPerDayCents).toBe(30_000);
  });

  it("com uma viagem só não estima nada", () => {
    const custos = costByKind([viagens[0]!], lancamentos, { today: "2026-07-01" });
    expect(custos.has("trip")).toBe(false);
  });

  it("evento futuro não entra no aprendizado", () => {
    const custos = costByKind(viagens, lancamentos, { today: "2026-06-01" });
    // Só a viagem de maio já aconteceu: amostra de um, sem estimativa.
    expect(custos.has("trip")).toBe(false);
  });
});

describe("monthPressure", () => {
  const historico = [
    ...mesComum("2026-05", 31, 50),
    ...mesComum("2026-06", 30, 50),
    ...Array.from({ length: 3 }, (_, i) =>
      tx({ date: `2026-05-${String(i + 10).padStart(2, "0")}`, amount: 300 }),
    ),
    ...Array.from({ length: 2 }, (_, i) =>
      tx({ date: `2026-06-${String(i + 5).padStart(2, "0")}`, amount: 300 }),
    ),
  ];
  const passadas = [
    ev({ id: "v1", kind: "trip", startsOn: "2026-05-10", endsOn: "2026-05-12" }),
    ev({ id: "v2", kind: "trip", startsOn: "2026-06-05", endsOn: "2026-06-06" }),
  ];

  it("estima o mês da viagem futura a partir das anteriores", () => {
    const futura = ev({
      id: "v3",
      kind: "trip",
      title: "Viagem para Paraty",
      startsOn: "2026-08-10",
      endsOn: "2026-08-13",
    });
    const pressao = monthPressure("2026-08", [...passadas, futura], historico, {
      today: "2026-07-01",
    });

    expect(pressao.events).toHaveLength(1);
    // Quatro dias a R$ 300 de excedente.
    expect(pressao.events[0]?.extraCents).toBe(120_000);
    expect(pressao.extraCents).toBe(120_000);
    expect(pressao.hasEstimate).toBe(true);
  });

  it("sem viagem passada, mostra o evento e admite que não sabe o custo", () => {
    const futura = ev({
      id: "unica",
      kind: "trip",
      startsOn: "2026-08-10",
      endsOn: "2026-08-13",
    });
    const pressao = monthPressure("2026-08", [futura], historico, { today: "2026-07-01" });

    expect(pressao.events).toHaveLength(1);
    expect(pressao.events[0]?.extraCents).toBeNull();
    expect(pressao.events[0]?.daysInMonth).toBe(4);
    expect(pressao.extraCents).toBe(0);
    expect(pressao.hasEstimate).toBe(false);
  });

  it("reunião de trabalho não gera pressão", () => {
    const reuniao = ev({ id: "r", kind: "work", startsOn: "2026-08-10" });
    expect(monthPressure("2026-08", [reuniao], historico).events).toHaveLength(0);
  });

  it("conta só os dias do mês na viagem que atravessa a virada", () => {
    const futura = ev({
      id: "v3",
      kind: "trip",
      startsOn: "2026-07-29",
      endsOn: "2026-08-02",
    });
    const pressao = monthPressure("2026-08", [...passadas, futura], historico, {
      today: "2026-07-01",
    });
    expect(pressao.events[0]?.daysInMonth).toBe(2);
    expect(pressao.extraCents).toBe(60_000);
  });
});

describe("classifyEvent — ordem da tabela", () => {
  it("viagem de aniversário continua sendo viagem", () => {
    expect(classifyEvent("Viagem de aniversário da Larissa")).toBe("trip");
  });

  it("hospedagem sozinha ainda vale como viagem", () => {
    expect(classifyEvent("Pousada em Trindade")).toBe("trip");
  });
});
