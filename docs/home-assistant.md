# Fluxo no Home Assistant

O Home Assistant lê um resumo do mês e as tarefas, cria e conclui tarefas e manda o consumo de energia. Ele fala com o
app por um código da casa, nunca com o login de alguém.

## Ligar

1. No Fluxo, abra **Casa → Home Assistant → Gerar o código da casa**.
2. O código aparece uma vez só. Copie a linha do `secrets.yaml` para o `secrets.yaml` do Home Assistant.
3. Copie o resto para o `configuration.yaml`. Se ele já tem `rest:`, `rest_command:` ou `utility_meter:`, junte os itens
   novos aos que já existem: a mesma chave não pode aparecer duas vezes.
4. Reinicie o Home Assistant (ou recarregue o YAML).

Perdeu o código? Gere outro na mesma tela: o anterior para de valer na hora.

## Sensores

| Sensor | O que mostra |
| --- | --- |
| `sensor.fluxo_gasto_do_mes` | Gasto do mês em R$. Atributos: previsto, % do previsto, ritmo de hoje, situação, receitas, saldo. |
| `sensor.fluxo_situacao_do_mes` | “no ritmo”, “acima do ritmo”, “passou do previsto”… |
| `sensor.fluxo_proxima_conta` | A próxima conta com data (“Condomínio · R$ 850,00 · em 3 dias”). Atributo `contas`: a lista. |
| `sensor.fluxo_contas_em_7_dias` | Quantas contas vencem na semana. |
| `sensor.fluxo_orcamentos_estourados` | Quantos orçamentos passaram do limite. Atributo `orcamentos`. |
| `sensor.fluxo_metas` | Quantas metas em andamento. Atributo `metas`. |
| `sensor.fluxo_energia_projecao` | O mês inteiro, em kWh, no ritmo de agora. |
| `sensor.fluxo_energia_custo_estimado` | A projeção vezes a tarifa da casa (R$). |
| `sensor.fluxo_tarefas_abertas` | Quantas tarefas abertas. Atributo `tarefas` (id, título, coluna, prazo). |

O resumo é refeito quando alguém da casa abre o app (no máximo a cada 5 minutos): os números só mudam quando alguém
usa o app. O Home Assistant só recebe totais, contas com data e metas. Nenhum lançamento, loja ou e-mail sai por aqui.

## Tarefas

- Nova tarefa: `rest_command.fluxo_nova_tarefa` com `titulo`. Ela entra no fim da primeira coluna do quadro.
- Concluir: `rest_command.fluxo_concluir_tarefa` com o `id` (do atributo `tarefas`).

Exemplo de script para a voz:

```yaml
script:
  fluxo_anotar:
    fields:
      titulo:
        description: O que fazer
    sequence:
      - action: rest_command.fluxo_nova_tarefa
        data:
          titulo: "{{ titulo }}"
```

## Energia

O app espera o **consumo do mês até o dia**, em kWh. É o que um `utility_meter` mensal sobre o medidor da casa conta:

```yaml
utility_meter:
  energia_mes:
    source: sensor.SEU_MEDIDOR_DE_ENERGIA   # kWh, um total que só cresce
    cycle: monthly
```

A automação da configuração manda o `sensor.energia_mes` de hora em hora, e não manda nada se o medidor estiver
indisponível. Mandar de novo no mesmo dia troca o valor do dia.

Na tela **Casa**, a **tarifa** (R$ por kWh: a conta de luz dividida pelo consumo dela, com impostos e bandeira) vira o
custo estimado. Na **Análise**, o cartão **Energia** mostra o mês até agora, a projeção, o mês passado e o custo.

## Endereços

Todos com `Authorization: Bearer <código>`:

| Método | Endereço | Corpo |
| --- | --- | --- |
| GET | `/api/ha/resumo` | — |
| GET | `/api/ha/tarefas` | — |
| POST | `/api/ha/tarefas` | `{"titulo": "..."}` |
| POST | `/api/ha/tarefas/concluir` | `{"id": "..."}` |
| POST | `/api/ha/energia` | `{"kwh": 123.4, "dia": "AAAA-MM-DD"}` (sem `dia`, vale hoje) |

Código errado responde 401; dado inválido, 400; banco sem a atualização do Home Assistant, 503.
