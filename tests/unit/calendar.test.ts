import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  costByKind,
  dailyBaselineCents,
  eventDays,
  eventDaysInMonth,
  eventCandidates,
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
    calendarEventId: null,
    eventLinkDecided: false,
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

describe("classifyEvent — armadilhas de uma agenda real", () => {
  it("endereço em 'Rua Dr.' não transforma o compromisso em consulta", () => {
    // O caso que apareceu na agenda de verdade: meia cidade brasileira mora
    // numa rua com nome de doutor, e o local entra na busca junto do título.
    expect(
      classifyEvent("Retirar diploma — Belas Artes", "Rua Dr. Álvaro Alvim, 90, 6º andar"),
    ).toBe("other");
    expect(classifyEvent("Almoço", "Av. Dr. Arnaldo, 200")).toBe("other");
    expect(classifyEvent("Reunião", "Praça Dr. João Mendes")).toBe("work");
  });

  it("continua reconhecendo consulta de verdade", () => {
    expect(classifyEvent("Consulta – CARDIOLOGIA", "AL MADEIRA, 258")).toBe("health");
    expect(classifyEvent("Dentista vini e Lari")).toBe("health");
    expect(classifyEvent("Exame de sangue")).toBe("health");
  });

  it("veterinário conta como saúde", () => {
    expect(classifyEvent("Vet Dori")).toBe("health");
    expect(classifyEvent("Veterinária da Mel")).toBe("health");
  });

  it("especialidade pelo nome, não por abreviação", () => {
    expect(classifyEvent("Ortopedista")).toBe("health");
    expect(classifyEvent("Pediatra do Isaac")).toBe("health");
  });
});

describe("spendDuringEvents — decisão de pessoa vence a data", () => {
  const festa = ev({
    id: "festa",
    kind: "celebration",
    startsOn: "2026-08-12",
    endsOn: "2026-08-12",
  });

  it("o que foi marcado como 'não é do evento' sai da conta", () => {
    // A assinatura que cobra no dia da festa não é despesa da festa, e é
    // exatamente esse ruído que estragava a estimativa da próxima.
    const resultado = spendDuringEvents(
      [festa],
      [
        tx({ id: "bolo", date: "2026-08-12", amount: 300 }),
        tx({
          id: "netflix",
          date: "2026-08-12",
          amount: 55,
          eventLinkDecided: true,
          calendarEventId: null,
        }),
      ],
    );
    expect(resultado[0]?.totalCents).toBe(30_000);
    expect(resultado[0]?.transactions.map((t) => t.id)).toEqual(["bolo"]);
  });

  it("o que foi vinculado entra mesmo caindo fora dos dias", () => {
    // A lembrança comprada na semana anterior pertence à festa.
    const resultado = spendDuringEvents(
      [festa],
      [
        tx({
          id: "presente",
          date: "2026-08-05",
          amount: 200,
          eventLinkDecided: true,
          calendarEventId: "festa",
        }),
      ],
    );
    expect(resultado[0]?.totalCents).toBe(20_000);
    expect(resultado[0]?.confirmedCount).toBe(1);
  });

  it("a decisão manda contra o evento mais específico do dia", () => {
    const viagem = ev({
      id: "viagem",
      kind: "trip",
      startsOn: "2026-08-10",
      endsOn: "2026-08-17",
    });
    // Pela data, o evento de um dia ganharia; a pessoa disse que é da viagem.
    const resultado = spendDuringEvents(
      [viagem, festa],
      [
        tx({
          id: "hotel",
          date: "2026-08-12",
          amount: 800,
          eventLinkDecided: true,
          calendarEventId: "viagem",
        }),
      ],
    );
    const porId = new Map(resultado.map((r) => [r.event.id, r.totalCents]));
    expect(porId.get("viagem")).toBe(80_000);
    expect(porId.get("festa")).toBe(0);
  });

  it("sem decisão, continua valendo o palpite por data", () => {
    const resultado = spendDuringEvents(
      [festa],
      [tx({ id: "x", date: "2026-08-12", amount: 90 })],
    );
    expect(resultado[0]?.totalCents).toBe(9_000);
    expect(resultado[0]?.confirmedCount).toBe(0);
  });
});

describe("o que o app SABE que não é do compromisso", () => {
  /**
   * A parcela é o caso que motivou isto, e o número vem da base real.
   *
   * Ela guarda a data da COMPRA original, então todas as parcelas de uma
   * compra caem no mesmo dia do calendário. MEDIDO: um compromisso em
   * 10/11/2025 veria a mesma compra duas vezes e somaria R$ 4.884 onde existe
   * uma cobrança de R$ 2.442; um em 07/01/2026 veria sete parcelas e somaria
   * R$ 3.990 por uma compra de R$ 570.
   */
  const festa = ev({
    id: "festa",
    kind: "celebration",
    startsOn: "2026-08-10",
    endsOn: "2026-08-10",
  });

  function parcela(current: number, total: number) {
    return tx({
      date: "2026-08-10",
      amount: 570,
      merchantNormalized: "MERCADOLIVRE 2PRODUTO",
      installment: { current, total, value: null },
    });
  }

  it("sete parcelas da mesma compra não somam sete vezes na festa", () => {
    const lancamentos = [
      ...Array.from({ length: 7 }, (_, i) => parcela(i + 1, 10)),
      tx({ date: "2026-08-10", amount: 120, merchantNormalized: "CONFEITARIA" }),
    ];

    const [resultado] = spendDuringEvents([festa], lancamentos);
    // Só o bolo. As R$ 3.990 de parcela ficam de fora.
    expect(resultado?.totalCents).toBe(12_000);
  });

  it("assinatura que cai no dia do compromisso não entra", () => {
    const lancamentos = [
      // Mesmo valor sempre: é cobrança de máquina, não escolha.
      ...["2026-06-10", "2026-07-10", "2026-08-10"].map((d) =>
        tx({ date: d, amount: 79.9, merchantNormalized: "STREAMING" }),
      ),
      tx({ date: "2026-08-10", amount: 120, merchantNormalized: "CONFEITARIA" }),
    ];

    const [resultado] = spendDuringEvents([festa], lancamentos);
    expect(resultado?.totalCents).toBe(12_000);
  });

  it("a lista mostra a parcela com o motivo, em vez de escondê-la", () => {
    // Esconder impediria o gesto que importa: uma passagem parcelada PODE ser
    // da viagem, e só a pessoa sabe.
    const candidatos = eventCandidates(festa, [
      parcela(3, 10),
      tx({ date: "2026-08-10", amount: 120, merchantNormalized: "CONFEITARIA" }),
    ]);

    expect(candidatos).toHaveLength(2);
    const fora = candidatos.find((c) => c.autoExcluded !== null);
    expect(fora?.autoExcluded).toBe("installment");
    // E desce para o fim, apesar de ser a de maior valor.
    expect(candidatos[0]?.autoExcluded).toBeNull();
  });

  it("decisão da pessoa vence o motivo automático", () => {
    // A passagem parcelada que ELA disse que é da viagem conta, e a linha
    // deixa de exibir motivo nenhum.
    const vinculada = {
      ...parcela(1, 10),
      eventLinkDecided: true,
      calendarEventId: "festa",
    };

    const [resultado] = spendDuringEvents([festa], [vinculada]);
    expect(resultado?.totalCents).toBe(57_000);

    const candidatos = eventCandidates(festa, [vinculada]);
    expect(candidatos[0]?.state).toBe("linked");
    expect(candidatos[0]?.autoExcluded).toBeNull();
  });
});
