# Política de revisão — análise descritiva 1.9

Reprodução, a partir da pasta `solution/`:

```sh
python3 -B analyze_policy.py
```

O resultado corresponde a [policy-analysis.json](policy-analysis.json). Fonte: cinco CSVs originais; referência 31/12/2017. A análise lê os dados e não muda a política, os arquivos ou o CRM.

## Limites e sensibilidade

| Política | Conversão | Saneamento | Qualificação | Mudaram de fila |
|---|---:|---:|---:|---:|
| >120 dias OU >2,5× ciclo — atual | 212 | 1.377 | 500 | 0 |
| >96 dias OU >2,5× | 128 | 1.461 | 500 | 84 |
| >144 dias OU >2,5× | 325 | 1.264 | 500 | 113 |
| >120 dias OU >2× | 180 | 1.409 | 500 | 32 |
| >120 dias OU >3× | 213 | 1.376 | 500 | 1 |

Fronteiras exclusivas: exatamente 120 dias ou 2,5× não ativa aquele limite. Entre Engaging com idade válida, 1.244 negócios ultrapassam ambos, 132 somente o limite absoluto, um somente o relativo e 212 nenhum. Portanto o critério relativo acrescenta um caso à união atual; isso não mede sua utilidade em outra carteira.

## Partição e duração observada

As 1.377 abertas em saneamento se dividem em **1** com 118 dias (KXR63BV7 / GTX Pro, ativada somente pela razão >2,5), **85** entre 121 e 138 dias e **1.291** acima de 138 dias. A partição soma 1.377; 138 dias não é um prazo máximo comercial.

O máximo de duração entre as 6.687 encerradas antes da referência é 138 dias. Para cada limiar inteiro t=0…138, calcula-se Won/(Won+Lost) entre encerradas com duração >=t. Entre os 138 pares consecutivos há **53 quedas**: a proporção não cresce monotonicamente. O JSON registra todos os denominadores e taxas; esse recorte selecionado não estima chances das abertas.

## Evidência a favor e contra a interpretação

Consideram-se apenas Won/Lost com datas válidas, início ≤ fechamento e fechamento estritamente anterior à referência: **6.687 fechados**, sendo 4.219 Won e 2.468 Lost. Os totais diferem do arquivo inteiro por causa do corte temporal.

- Won: mediana 57 dias, p90 106 dias pelo método inclusivo; **145/4.219 (3,44%)** ultrapassaram 120 dias.
- Lost: mediana 14 dias.
- Fechados com duração <30 dias: **1.809/3.150 (57,43%)** Won.
- Fechados com duração >120 dias: **145/191 (75,92%)** Won.

Os 120 dias são uma hipótese de disparo para revisar continuidade, contextualizada pela cauda dos ganhos observados. Não foram otimizados nem validados como fronteira ideal. A taxa maior entre fechados demorados impede interpretar idade, isoladamente, como motivo suficiente para encerrar.

Essas taxas condicionam a amostra à duração final e ao fato de o negócio ter fechado. Há seleção e ausência de snapshots; não são probabilidades das abertas, comparação causal ou avaliação de eficácia das filas. Ciclos derivados só de ganhos também têm viés de seleção.

## Efeito sobre a rotina

Central: 908 abertas, zero conversão, 408 saneamento e 500 qualificação. Todas as 500 Prospecting abertas estão na Central. Suas 408 Engaging têm início entre **19/07/2017 e 15/08/2017**, idades **138–165 dias**. Entre encerradas da Central com início >=16/08/2017 e fechamento <31/12/2017, há **774 = 466 Won + 308 Lost**. Ao incluir fechamentos em 31/12, há **783 = 474 Won + 309 Lost**, nove adicionais. Datas concentradas são um achado da amostra, sem comprovar causas comerciais.

East: 433 abertas, 74 conversão; West: 748 abertas, 138 conversão. Dez dos 27 vendedores com abertas ficam sem conversão. O aplicativo oferece as filas alternativas mantendo a seleção, sem sugerir que esses vendedores não tenham trabalho relevante.

Dezenove dos vinte maiores índices originais estão em saneamento. O índice permanece nos detalhes como referência explicável e alternativa de ordenação; a recomendação principal é motivo e próximo passo na fila.

## Decisão proposta para RevOps

Revisar casos discordantes e próximos aos limites com responsáveis comerciais. Registrar último contato e próximo passo, conferir projetos ativos e ajustar a política com evidência prospectiva. Um resultado de saneamento solicita confirmação humana; não indica encerramento nem impede atuação comercial.

## Laboratório na interface

O painel recolhido “Laboratório de políticas operacionais” calcula cenários somente sobre as abertas originais, independentemente de filtros ou simulação de índice. Fronteiras continuam exclusivas; razão ausente/sem mediana positiva não dispara o limite relativo. É possível avaliar somente dias. Os resultados mostram universo, referência e hash de dataset, contagens, reclassificações, itens Central em conversão e vendedores com conversão, incluindo acréscimos em relação à base. Nada é aplicado à fila, ranking ou exportação. Alterar controles invalida o resultado anterior; restaurar os limites mostra novamente a política-base.
