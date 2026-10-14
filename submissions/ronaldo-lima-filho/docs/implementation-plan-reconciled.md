# Plano reconciliado — execução local 1.9

Origem: plano de melhorias fornecido pelo autor, lido integralmente em 14/10/2026. A versão original e os registros intermediários permanecem preservados localmente; este documento registra a reconciliação para a base 1.8.1 e a implementação 1.9.

## Reconciliação e escopo

1. **Gestor:** já mostra as três filas e o subconjunto na janela, com denominadores por carteira completa, incluindo vendedores sem abertas. Preservar a apresentação em linhas acessíveis. Completar contexto com percentual acima de 90 dias e verificar gestores sem conversão e mistos.
2. **Agrupamento:** já oferece caminhos explícitos para coordenar contas identificadas e identificar órfãs, com exportações por caminho. Preservar essa escolha existente, em vez de introduzir uma terceira visualização combinada. Ordenar contas por quantidade nesta fila, soma de catálogo e nome para desempates reproduzíveis. Cada órfã permanece individual; explicitar que o caminho cadastral não estima chance de ganho. Qualificação tem **337** sem conta e 163 identificadas, não 288. Saneamento tem **937** sem conta e 440 identificadas, não 1.137 sem conta; conversão tem 151 sem conta e 61 identificadas. O total é 1.425 órfãs. Acrescentar `subsidiary_of` literal e contagem de registros que declaram a conta como controladora; desconhecidos continuam null. Sem consolidação de receitas ou inferência de instalação/homologação.
3. **Simulação:** “Simular índice” já explica a separação e oferece comparação explícita. Preservar. Adicionar laboratório recolhido independente, com dias inteiros de 1 a 3.650 e razão finita de 0,1 a 100 ou somente dias, defaults 120/2,5. Usar sempre `base.rows`, sem filtrar ou mutar ranking, filas, seleção, revisão, regras ou exportações. Mostrar referência, política-base, contagens, reclassificações, itens da Central e vendedores com conversão e quantos foram acrescentados em relação à base. Rejeitar inválidos, limpar resultado antigo e permitir restauração local.
4. **JEV:** três fixtures fixas selecionáveis (`insufficient_context` padrão, `explicit_next_step`, `explicit_objection`), fonte synthetic_fixture e confiança/probabilidades null. Seletor apenas em mock, texto ilustrativo e aviso de que texto livre não é interpretado. Invalidar respostas ao trocar exemplo; voltar/fechar limpa seleção e texto. Campo `mock_category` aceito apenas para mock; categorias inválidas rejeitadas antes de qualquer transporte. Padrão desativado, fallback local, sem credenciais ou chamadas externas/pagas.
5. **Análise:** reproduzir partição saneamento 1/85/1.291, caso exclusivo KXR63BV7 com 118 dias, máximo histórico 138 e 53 quedas entre taxas cumulativas de fechadas com duração >=t para t=0…138. Central: 500 Prospecting e 408 Engaging; encerradas recentes são **774 = 466 Won + 308 Lost**, corrigindo 510/264 do plano. Inclusão de 31/12 produz 783 = 474 Won + 309 Lost. Registrar datas/faixas e limitações descritivas.

## Contratos preservados

Prioridade para revisão comercial, não probabilidade validada. 8.800 originais, 2.089 abertas, 6.687 fechadas estritamente antes de 31/12/2017. Prospecting pode não ter engage_date; idade desde início não mede último contato. Ausência não é desempenho ruim. Sem encerradas na fila ativa ou resultados de fechamento no score. Explicações, regras, proveniência e referência reproduzíveis; score-base e CSVs preservados. Sem push, publicação, deploy, custos ou intervenção em outros projetos. ZIP 1.8.1 permanece intacto.

## Validação e entrega

- Rodar unittest completo, Node UI, análise, sintaxe JS/Python, invariância da projeção-base, bytes CSV e manifesto atualizado após a última alteração.
- Rodar Chrome real instalado no Mac via Playwright, desktop 1440 px e mobile 375 px; testar repetições, restauração/cancelamento/volta, estados vazios/erro, foco, contexto e exportações. Interações visíveis adicionais no navegador do Mac se disponível. Capturas novas em docs/validation-v1.9, sem substituir evidências antigas.
- Registrar exatamente resultados e bloqueios no relatório local; não declarar conclusão com processos pendentes. Teste independente com usuários e validação comercial continuam pendentes.

## Estado inicial

28/28 Node passaram. Python: 38 testes executados; único erro inicial foi bind HTTP bloqueado pelo sandbox antes de executar a classe HTTP. Reexecutar com permissão para loopback local. Nenhum AGENTS.md próprio ou skill do checkout foi encontrado; instruções herdadas de /Users/ronaldo/AGENTS.md e RTK.md foram lidas. Outra tarefa ativa revisa uma cópia do ZIP, sem edição concorrente observada. Tentativa de comunicar resumo ao pai retornou thread not found; final da delegação será o canal de retorno.

## Ajuste encontrado durante a execução

A validação em porta independente 8766 reproduziu HTTP 403 no JEV por whitelist fixa em 8765. O endpoint agora valida origens localhost/127.0.0.1 contra a porta real do servidor, sem aceitar origem externa, HTTPS inesperado ou outra porta. Teste HTTP cobre aceitação e recusas. Isso permite validar sem interferir na outra instância/revisão.

## Estado final

Execução local concluída: 48 Python, 32 Node e 26 cenários Chrome passaram, além de sintaxe, análise reproduzida, hashes do manifesto, projeção-base e CSVs preservados. [Relatório e evidências](verification-v1.11.1.md). Inspeção nativa no Chrome confirmou cenário 144/2,5 e restauração. Na etapa de implementação não foi criado novo ZIP, publicado conteúdo, configurada credencial ou gerado custo. O empacotamento posterior 1.9 está documentado em revops-verification.md; teste com usuários permanece pendente.

## Continuidade 1.10

Este plano registra a etapa anterior. As três melhorias autorizadas posteriormente, seus critérios de aceitação e evidências atuais estão em [verification-v1.11.1.md](verification-v1.11.1.md), com capturas em validation-v1.11.1. Os arquivos da versão 1.9 permanecem nos pacotes históricos preservados.
