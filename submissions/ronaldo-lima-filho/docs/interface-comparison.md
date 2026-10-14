# Comparar oportunidades e iniciar a revisão — 1.7.4

A lista alinha oportunidade, responsável, motivo e ação no desktop. No celular, esses grupos aparecem na mesma ordem em um cartão compacto. Histórico da empresa, recomendação completa, regra e revisão reversível ficam nos detalhes. Avisos específicos de cadastro permanecem visíveis.

“Ver detalhes” expande a oportunidade na própria lista. Fechar devolve o foco ao comando e a rolagem ao ponto de origem, preservando filtros, ordenação e página. A contagem de oportunidades mostra apenas “Mostrando X de Y oportunidades”; agrupamento informa grupos e oportunidades separadamente.

A revisão registra somente que a pessoa conferiu o item nesta aba. É possível desmarcar; há feedback imediato e estado visível na lista. Recarregar apaga a marcação. Nenhum contato, correção ou atualização do CRM é executado.

## O que significam os 61 dias

No CSV fornecido, GTX Basic tem **911 negócios ganhos** com datas válidas e `engage_date <= close_date < 2017-12-31`. A mediana de `close_date - engage_date` é **61 dias**. O primeiro início desses registros é 25/10/2016; os fechamentos vão de 01/03/2017 a 30/12/2017.

A idade de Bioplex, 117 dias, mede `2017-12-31 - engage_date`. Ambos começam no início de Engaging; o final da idade é a referência da fotografia e o final do ciclo histórico é o fechamento. A idade aberta ainda não é uma duração final. Não há histórico de reentradas para certificar tempo contínuo na etapa.

A política propõe atenção entre 1 e 2 ciclos medianos, inclusive: para GTX Basic, **61–122 dias**. Bioplex (117) e Iselectrics (116) estão nessa faixa. A interface a identifica como proposta; ela não representa prazo máximo, atraso comprovado, contato recente ou probabilidade de ganhar. O grupo histórico contém somente ganhos, com viés de seleção, e a comparação não valida comercialmente a regra. Sem ciclo positivo, a política usa a faixa alternativa de 30–90 dias.

## Referências e aplicação

As decisões são aplicações para esta tarefa, e não layouts prescritos pelos autores nem evidência de melhoria já medida:

- [Nielsen — heurísticas de usabilidade](https://www.nngroup.com/articles/ten-usability-heuristics/): reduzir leitura repetida, manter campos comparáveis visíveis e oferecer feedback e desfazer.
- [Norman — prefácio da edição revista de The Design of Everyday Things](https://jnd.org/preface-design-of-everyday-things-revised-edition/): comandos identificáveis e estado visual separado de ação. A condição da conta aparece como texto, sem aparência de botão.
- [Shneiderman — The Eyes Have It](https://drum.lib.umd.edu/items/155a868e-fb83-4115-9899-9187ea8c0498): visão geral, filtragem e detalhes sob demanda.

Alinhamento, espaçamento e grupos internos organizam a oportunidade. A avaliação automatizada cobre comportamento e dimensões; o [teste com participantes](user-test-protocol.md) continua pendente. Ele deve verificar comparação, compreensão do motivo, marcação/desmarcação e confusão entre idade, atraso e contato recente.


## Painel de revisão 1.8

O comando “Ver detalhes” abre um diálogo lateral de 720 px no desktop e uma tela completa no celular. A lista mantém filtros, ordenação, página e posição. O cabeçalho conserva identidade, responsável, data-base e fechamento. A área de leitura tem largura controlada e rolagem própria; a marcação temporária fica no rodapé visível.

Há uma recomendação curta, seguida do tempo observado e da mediana. Histórico comercial e perfil cadastral são grupos distintos de rótulos e valores. “Oportunidades ganhas” conta registros Won anteriores à referência; não comprova transações, compras ou contrato ativo. Receita anual usa milhões de USD conforme metadata.csv. O período dos atributos cadastrais não está informado na fonte.

“Critérios e origem dos dados” começa recolhido. Reúne regra, limites, população, quantidade e período dos ganhos, composição do índice, fontes, ausências e completude. A soma de catálogo fica nessa auditoria, com moeda não confirmada e distinção de valor negociado. As datas inicial e final da amostra são derivadas dos mesmos ganhos válidos que sustentam a mediana; o corte continua estritamente anterior à data-base.

| Referência | Aplicação ao painel |
|---|---|
| Nielsen, H8 | Uma recomendação, explicação complementar e metodologia recolhida |
| Nielsen, H1 e H3 | Feedback no rodapé ao marcar/desmarcar, revisão reversível e efeito temporário explícito |
| Shneiderman | Contexto consultável e auditoria sob demanda |
| Norman | Aparência de comando para fechar, voltar, expandir e analisar nota; dados apresentados como informação |
| Palmer, região comum | Histórico e perfil em grupos visuais separados, com rótulos e valores |

São decisões para esta tarefa, não um formato imposto pelos autores. Referências: [Nielsen](https://www.nngroup.com/articles/ten-usability-heuristics/), [Norman](https://jnd.org/preface-design-of-everyday-things-revised-edition/), [Shneiderman](https://drum.lib.umd.edu/items/155a868e-fb83-4115-9899-9187ea8c0498) e [Palmer](https://www.sciencedirect.com/science/article/pii/001002859290014S).

O diálogo contém o foco do teclado. Esc, fechar, voltar e clique fora restauram foco e contexto. Marcar ou desmarcar preserva o painel e a rolagem interna; recarregar apaga a revisão. Fechar descarta a nota opcional e invalida respostas tardias. A aplicação não registra ações no CRM. Esses comportamentos foram exercitados em navegador; a compreensão por vendedores ainda depende do protocolo com participantes.


## Gestão, agrupamento e simulação 1.8.1

O painel de 1:1 troca o indicador isolado de 90 dias por contagens de conversão, saneamento e qualificação por vendedor. A janela de atenção aparece como subconjunto da conversão. O denominador continua sendo a carteira aberta completa do gestor, incluindo vendedores sem abertas; os demais filtros não alteram esse resumo.

Agrupar por conta oferece dois caminhos visíveis, com contagens: coordenar contas identificadas ou identificar contas sem vínculo. Contas são ordenadas pela quantidade de oportunidades na fila; empates mantêm a ordenação selecionada. No segundo caminho, cada oportunidade permanece individual, sem inferir vínculo entre registros. Os atalhos substituem o filtro Com/Sem conta, preservando vendedor, gestor, região, etapa, busca e revisão. Paginação e exportações seguem o caminho escolhido; um caminho vazio oferece acesso ao outro. A visualização de oportunidades continua usando a ordenação existente, sem alteração de índice ou política.

Simular índice nomeia o efeito efetivo da função. O aviso informa a quantidade de índices diferentes e explica que filas e ordem operacional continuam iguais. O comando Comparar por maior índice muda explicitamente a ordenação; não troca de fila nem apaga os demais filtros. A restauração recupera os valores originais. Não foi implementado um laboratório de política operacional, e nenhuma melhora comercial é inferida da simulação.


## Revisão com continuidade — 1.11

“Seu próximo passo” mostra o registro salvo; o roteiro fica em uma expansão própria, com duas perguntas por fila e uma adicional para conferir conta desconhecida. Respostas vazias continuam pendentes. Digitação e salvamento são estados distintos, com feedback de persistência ou falha. Desfazer, exportar e exclusão confirmada dão controle sobre os registros locais; o rodapé mantém a marcação temporária separada.

A coordenação usa a seção já existente de outras abertas da conta. Sinaliza somente mesmo produto/outro vendedor, com explicação factual e sem atribuir conflito ou redistribuir responsabilidade. Isso preserva a lista compacta e deixa a revisão operacional nos detalhes. As capturas e cenários atuais estão em [verificação 1.11](verification-v1.11.1.md); não constituem validação independente com usuários.
