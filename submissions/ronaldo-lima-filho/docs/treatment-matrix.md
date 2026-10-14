# Decisões e verificação — versão local 1.11.1

Esta matriz descreve o estado da entrega atual. Pareceres e registros anteriores foram preservados localmente; suas conclusões não substituem as evidências desta versão.

| Tema da revisão | Tratamento | Evidência |
|---|---|---|
| Abertura direta do HTML | Detecta protocolo de arquivo, evita chamada à API e mostra comando/URL; falhas HTTP recebem instruções e retry preserva busca | Teste Node com protocolo simulado e cenário Chrome de falha HTTP/recuperação |
| Confirmação de cópia antiga | Mensagem limpa ao renderizar nova seleção; sucesso ou falha tardios não repõem mensagem da seleção anterior | Dois testes Node e cenário Chrome |
| Histórico em português | “Lost anteriores” traduzido para “negócios perdidos anteriormente” | Asserção no navegador e capturas atuais |
| Captura da Central cortada | Página completa, com filtros secundários recolhidos e todos os botões de alternativa | `validation-v1.11.1/central-empty.png` |
| Fila padrão vazia para Central e parte dos vendedores | Estado vazio distingue ausência na fila de ausência na seleção; atalhos mantêm vendedor, região e filtros | `solution/index.html`, testes Node e cenários de navegador |
| Índice original compete com a ação | Removido do cartão; soma e componentes mantidos nos detalhes; ordenação alternativa continua disponível | Teste Node e capturas atuais |
| Primeira ação abaixo da tela móvel | Entrada compactada; filtros secundários recolhidos; medição de posição na tela 375×844 | `validation-v1.11.1/layout-results.json` e captura móvel |
| Definição dos limites | Análise reproduzível de sensibilidade, critérios sobrepostos e duração dos fechados; saneamento solicita continuidade, sem encerramento por idade | `policy-analysis.md`, `policy-analysis.json`, `solution/analyze_policy.py` |
| Estrutura do template | H1 com autor/challenge; blocos Solução, Abordagem, Resultados / Findings, Recomendações e Limitações explícitos | README |
| Processo de IA | Relato em primeira pessoa com atribuição da execução, ferramentas, rodadas e correções verificáveis; 13 registros não equivalem ao total de prompts | `process-log/log.md` |
| Termo baseline | Definido como regras/ordem originais do projeto, distinto do benchmark privado G4 | README, seção Abordagem |
| Código de interface denso | CSS, JS e HTML formatados; verificações funcionais refeitas | `solution/index.html`, resultados Python/Node/navegador |
| Preparação do PR | Conteúdo curado do ZIP; pasta única, inclusão explícita devido ao gitignore, mudanças da raiz fora do PR; nenhuma publicação executada | `submission-preparation.md`, manifesto do pacote |
| Validação com participantes | Protocolo curto para uma ou duas pessoas; execução pendente, sem recrutamento nem resultados inventados | `user-test-protocol.md` |
| Regras e dados anteriores | Critérios de classificação e cinco CSVs preservados; texto da ação de saneamento atualizado em operations-v1.2; baseline original invariável | Testes Python e manifesto |

A versão é uma demonstração histórica local. Não há comprovação de ganho comercial, backtest temporal, teste humano independente, acurácia JEV ou prontidão de produção.

## Acabamento dos cartões 1.8

O aviso de último contato ausente saiu dos cartões e permanece nas limitações gerais. O momento aparece em destaque, seguido de idade e ciclo mediano; razão e limites detalhados ficam em “Ver detalhes”. Avisos específicos de cadastro continuam visíveis.

## Comparação e revisão 1.8

Quatro colunas alinhadas; idade factual e faixa numérica proposta; histórico e controle de revisão nos detalhes; retorno preserva contexto. Feedback de marcação e desmarcação esclarece o efeito somente nesta sessão. Contagem elimina repetição para oportunidades; agrupamento distingue grupos e quantidade de oportunidades.

## Detalhes para revisar 1.8

Painel com largura controlada, uma recomendação e justificativa curta. Histórico e perfil separados. Metodologia, catálogo e índice recolhidos. Ganhos nomeados como oportunidades; amostra com datas reais. Rodapé mantém marcação temporária e feedback. Testes cobrem teclado, Esc, clique fora, retorno, marcação, nota e respostas tardias.


## Acabamento 1.8.1

| Tema | Tratamento | Evidência |
|---|---|---|
| Painel do gestor | Contagens das três filas e subconjunto na janela; carteiras completas e vendedores sem abertas | Teste Node e cenário Chrome, capturas desktop e celular |
| Agrupamento | Dois caminhos com contagens; contas por volume de oportunidades, sem vínculo em registros individuais; exportação do caminho escolhido | Testes Node, exportação real e cenários Chrome desktop/celular |
| Simulação pouco evidente | Simular índice, quantidade alterada, efeito explicitado e comando Comparar por maior índice | Teste Node e cenário Chrome na ordenação operacional, comparação e restauração |
| Evolução JEV | README distingue finalidade, fluxo entregue, mock fixo e serviço real não usado; avaliação em português e piloto propostos | README e contrato opcional; nenhuma ativação |


## Pacote 1.9

Roteiro de preparação corrigido para o ZIP 1.9 e seu SHA-256. Documentação de entrega, testes e manifestos alinhados à versão atual. Os complementos de contexto cadastral, laboratório e três exemplos JEV estão descritos no [relato da implementação](verification-v1.11.1.md). O teste com participantes permanece pendente.

## Melhorias 1.10

| Tema | Tratamento | Evidência |
|---|---|---|
| Casos de fronteira no laboratório | Lista paginada com IDs, transição e motivo; CSV completo com proveniência; edição invalida casos antigos | Testes Node, download real, capturas desktop/celular |
| Outras abertas da conta | Escopo completo por conta identificada, exclui a atual; detalhes e retorno preservam contexto, sem unir órfãs | Testes Node, navegação Chrome, capturas desktop/celular |
| Atalhos no gestor | Vendedor e fila em um clique; mantém demais filtros e denominadores do painel | Testes Node e cenários Chrome desktop/celular |

As regras e os cinco CSVs permanecem intactos. O teste com participantes continua pendente.

## Acabamento 1.10.1

Botões do gestor com largura reservada para o rótulo e palavras inteiras. Cenário Chrome em 1440/1024/861/375/320 px verifica o texto e a ausência de overflow; capturas do gestor atualizadas. Nenhuma regra, contagem ou critério de fila foi alterado.


## Melhorias autorizadas — 1.11

| Pedido | Tratamento | Evidência |
|---|---|---|
| Próximo passo salvo | Registro explícito local por base/ID, reload, desfazer até cinco versões, exportar/apagar e falhas visíveis | test_workflow.cjs e cenários Chrome atuais |
| Roteiro por fila | Perguntas específicas e pendências explícitas, resumo declarado sem inferir contato | Testes Node e Chrome para as três filas e conta desconhecida |
| Coordenação por conta/produto | Coincidência com outro vendedor nos detalhes, IDs exatos, navegação preservada | Teste de alias/exclusões e Chrome desktop/mobile |
| Preservar regras | Motor, dados, política e projeção congelada iguais; sem entrada de anotações no JEV | Manifestos, testes de contratos e análise byte a byte |
| Sem atualizar PR | Cópia local independente; branch/head/índice do checkout do PR preservados | Recibo externo da entrega 1.11 |


## Correções da revisão final — 1.11.1

| Achado | Correção | Verificação |
|---|---|---|
| Conexão ociosa bloqueia o servidor | Atendimento por conexão com ThreadingHTTPServer; teste usa a mesma fábrica do aplicativo | Regressão falha no servidor 1.11 e passa no corrigido, mantendo socket aberto enquanto HTML/script/fonte/API respondem |
| Caminho textual antigo no plano | Capturas atuais apontam a validation-v1.11.1 | Inventário, links e conferência de referências |
| Referência do README | Nomeia a seção correta e usa rótulo de verificações atuais | Destino verification-v1.11.1.md presente |

O navegador também verifica abertura real file→link HTTP e persistência após reinício completo. O ZIP 1.11 e o PR existente foram preservados.
