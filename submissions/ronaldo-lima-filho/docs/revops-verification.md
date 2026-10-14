# Verificação — versão local 1.10.1 — 14/10/2026

As três melhorias estão implementadas e verificadas: casos reclassificados no laboratório, outras abertas da mesma conta e atalhos por fila no painel do gestor. [Decisões e aceitação](verification-v1.10.1.md).

- **48 testes Python:** [saída integral](validation-v1.10.1/python-tests.txt).
- **38 testes Node:** [saída integral](validation-v1.10.1/node-tests.txt).
- **37 cenários Chrome:** [recibo](validation-v1.10.1/browser-results.json) e [saída](validation-v1.10.1/browser-output.txt).

## Evidências dos novos fluxos

| Fluxo | Resultado |
|---|---|
| Casos reclassificados | 113 IDs exatos no cenário >144 dias OU >2,5×; quatro páginas sem duplicação ou omissão |
| CSV do laboratório | Download real com todos os 113 casos, transição, motivo, limites e proveniência; exportação principal inalterada |
| Edição e restauração | Resultado anterior ocultado e exportação desativada ao editar limites, inclusive entrada vazia; base tem zero casos |
| Detalhes pelo laboratório | Consulta fora da página principal, revisão temporária após render e retorno do foco ao caso; filtros preservados |
| Outras abertas da conta | Iselectrics: outras 12 abertas de toda a base; exclui a atual, inclui outros vendedores/filas, não une órfãs |
| Retorno entre oportunidades | Navegação A → B → A e volta preserva painel, rolagem, foco, filtros e marcações |
| Atalhos do gestor | Anna/Central abre saneamento 57, qualificação 55 e conversão zero mantendo vendedor/gestor/região |
| Celular | Os três novos fluxos cabem em 375×844, sem rolagem horizontal |

## Capturas reais

- [Casos no laboratório — desktop](validation-v1.10.1/desktop-policy-cases.png) e [celular](validation-v1.10.1/mobile-policy-cases.png).
- [Outras abertas da conta — desktop](validation-v1.10.1/desktop-account-opportunities.png) e [celular](validation-v1.10.1/mobile-account-opportunities.png).
- [Atalhos do gestor — desktop](validation-v1.10.1/desktop-manager-shortcuts.png) e [celular](validation-v1.10.1/mobile-manager-shortcuts.png).
- [Lista de conversão](validation-v1.10.1/desktop-conversion.png), [primeira ação no celular](validation-v1.10.1/mobile-conversion.png), [detalhes](validation-v1.10.1/desktop-review.png) e [Central vazia](validation-v1.10.1/central-empty.png).
- [CSV dos casos reclassificados](validation-v1.10.1/policy-reclassified.csv).

As 24 capturas, demais exportações e recibos estão relacionados no manifesto da implementação. Os 26 cenários anteriores foram mantidos: início e recuperação, teclado/fechamento, revisão reversível, filtros/página/rolagem, agrupamento e exportações, cópia, simulação do índice, laboratório, contexto cadastral, JEV mock e descarte de respostas tardias. Dez cenários acrescentam as três melhorias e suas regressões; um cenário adicional verifica as palavras dos botões do gestor em cinco larguras de tela.

## Integridade e preservação

Projeção das 2.089 decisões originais: `d758d0023dff0fd18a7114a525065899db5fb243b96c19fc1268bbb1fd2e3b10`. Dataset: `c5a0244edc0ccd97307ee4ac88fff5cae566bb411f9b3e11fcaf8d43827828f3`. Regras de pontuação, política operacional, classificação, mediana e bytes dos cinco CSVs preservados. Filas: 212 conversão, 1.377 saneamento e 500 qualificação. Análise JSON reproduzida byte a byte.

[Manifesto da implementação](implementation-manifest.json), [manifesto do pacote](package-manifest.json) e [preparação do PR](submission-preparation.md). O manifesto do pacote exclui seu próprio hash. O ZIP e seu sidecar são conferidos após a extração final; versões anteriores preservadas.

## Ambiente e limites

Python 3.14.7, Node 22.22.3 e Chrome instalado via Playwright, em modo headless. Python 3.10 é o mínimo declarado, mas não foi executado nesta máquina. As suítes usam cópia isolada e servidor em porta independente, ambiente mínimo, JEV desativado e rede externa bloqueada no sandbox; nenhuma credencial herdada. Sem erros JavaScript ou tentativas externas observadas.

A orientação de abertura file: permanece verificada por protocolo simulado em teste de lógica; a recuperação HTTP foi exercitada em Chrome. Capturas e viewport móvel não equivalem a telefone físico, auditoria integral de acessibilidade ou teste independente com vendedores. [Medição da primeira ação](validation-v1.10.1/layout-results.json).

O [teste com participantes](user-test-protocol.md), a validação comercial, o ganho de conversão e a acurácia JEV continuam pendentes. Revisões são temporárias nesta aba; o laboratório não aplica política; a base é histórica em 31/12/2017. Não houve publicação, envio, fork, branch, commit, push, PR, deploy, alteração de CRM, inferência real ou gasto.

## Correção visual 1.10.1

A coluna do comando recebe dois terços do espaço disponível, com quebra somente entre palavras; contagem e janela usam a coluna restante. A regressão verifica cada palavra de “Ação de conversão” em todos os cartões visíveis do gestor a 1440, 1024, 861, 375 e 320 px, sem rolagem horizontal. [Medições](validation-v1.10.1/manager-label-layout.json).
