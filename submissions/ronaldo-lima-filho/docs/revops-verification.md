# Verificação — versão local 1.11.1 — 14/10/2026

Próximo passo salvo, roteiro por fila e coordenação por conta/produto estão implementados. [Decisões e aceitação](verification-v1.11.1.md).

- **51 testes Python:** [saída integral](validation-v1.11.1/python-tests.txt).
- **65 testes Node:** [saída integral](validation-v1.11.1/node-tests.txt), incluindo 12 testes do módulo local e as 53 regressões anteriores.
- **69 cenários Chrome:** [recibo](validation-v1.11.1/browser-results.json) e [saída](validation-v1.11.1/browser-output.txt), mantendo os 67 cenários da 1.11 e acrescentando dois de inicialização e reinício completo.
- [Conferência agregada e invariantes](validation-v1.11.1/aggregate-checks.json).

## Evidências dos três fluxos

| Fluxo | Evidência verificada |
|---|---|
| Próximo passo | Salvar, reload, editar, desfazer após reload e separar a marcação temporária de revisão |
| Roteiro | Perguntas de cada fila, vínculo desconhecido, campos pendentes e resumo com origem salva/rascunho |
| Exportação | Download JSON com identidade histórica e registros; rascunho não salvo fica fora |
| Falhas | Quota, dados ilegíveis, aba desatualizada e exclusão confirmada limitada à base |
| Texto armazenado | Conteúdo HTML sintético não executa em campos, resumo ou histórico após reload |
| Coordenação | IDs exatos da mesma conta/produto e outro vendedor, aviso histórico e retorno preservando filtros |
| Celular | Formulário e coordenação sem rolagem horizontal em 375/320 px |
| Preservação | Todas as linhas da API, IDs, posições, pontuações e filas iguais depois das operações |

## Capturas reais

- [Próximo passo e roteiro — desktop](validation-v1.11.1/desktop-next-step.png) e [celular](validation-v1.11.1/mobile-next-step.png).
- [Ações e salvamento — desktop](validation-v1.11.1/desktop-next-step-actions.png) e [celular](validation-v1.11.1/mobile-next-step-actions.png).
- [Coordenação por produto — desktop](validation-v1.11.1/desktop-coordination.png) e [celular](validation-v1.11.1/mobile-coordination.png).
- [Aviso de armazenamento](validation-v1.11.1/local-storage-warning.png) e [JSON de anotação sintética](validation-v1.11.1/synthetic-local-review.json).
- [Casos no laboratório](validation-v1.11.1/desktop-policy-cases.png), [outras abertas da conta](validation-v1.11.1/desktop-account-opportunities.png) e [atalhos do gestor](validation-v1.11.1/desktop-manager-shortcuts.png).
- [Lista de conversão](validation-v1.11.1/desktop-conversion.png), [primeira ação móvel](validation-v1.11.1/mobile-conversion.png) e [Central vazia com alternativas](validation-v1.11.1/central-empty.png).

São 35 capturas atuais. Os cenários anteriores continuam cobrindo início/recuperação, teclado, fechamento, filtros, página/rolagem, revisão reversível, agrupamento, exportações, cópia, índice, laboratório, contexto por conta e JEV sintético. O cenário de rótulos do gestor verifica palavras inteiras em 1440/1024/861/375/320 px. [Medições](validation-v1.11.1/manager-label-layout.json).

## Integridade e preservação

Projeção original: `d758d0023dff0fd18a7114a525065899db5fb243b96c19fc1268bbb1fd2e3b10`. Dataset: `c5a0244edc0ccd97307ee4ac88fff5cae566bb411f9b3e11fcaf8d43827828f3`. Regras, política, mediana e bytes dos cinco CSVs preservados. Filas: 212 conversão, 1.377 saneamento, 500 qualificação. Análise JSON reproduzida byte a byte; exportação do laboratório mantém os 113 IDs exatos no cenário >144 dias OU >2,5×.

[Manifesto da implementação](implementation-manifest.json), [manifesto de todos os arquivos](package-manifest.json) e [preparação de futura atualização](submission-preparation.md). O manifesto do pacote exclui seu próprio hash. O sidecar externo confere o ZIP; extração, CRC, tamanhos e hashes internos são verificados ao empacotar. Anotações reais do navegador não entram no ZIP; somente uma fixture sintética explicitamente identificada.

## Ambiente e limites

Python 3.14.7, Node 22.22.3 e Chrome instalado via Playwright, headless. Python 3.10+ e Node 18+ são os mínimos documentados, sem execução dessas versões mínimas nesta máquina. A aplicação não requer Node. Testes usam cópia isolada, porta independente, ambiente mínimo sem credenciais, JEV desativado e rede externa bloqueada. As sondas de isolamento confirmaram bloqueio de leitura/escrita fora do escopo e conexão externa. Zero erros de página ou tentativas externas observadas; zero chamadas reais ou pagas ao JEV.

O protocolo de arquivo permanece coberto por teste de lógica e a recuperação HTTP por Chrome. Viewport móvel não equivale a telefone físico; verificações técnicas não equivalem a teste independente de vendedor, avaliação comercial ou auditoria integral de acessibilidade. A persistência é local ao navegador e não comprova ação no CRM. Não houve atualização do PR, commit, push, publicação, submissão ou deploy nesta rodada.


## Correção de servidor e referências 1.11.1

[Regressão no servidor antigo](validation-v1.11.1/idle-regression-before.txt) e [resultado após a correção](validation-v1.11.1/idle-regression-after.txt): a conexão é aceita e permanece sem requisição, enquanto HTML, script, fonte e API devem responder. A suíte usa a mesma fábrica de servidor que o comando do aplicativo. Motor, CSVs e regras não participam da mudança.

[Abertura real do arquivo](validation-v1.11.1/startup-file.png), [fila carregada pelo link](validation-v1.11.1/startup-recovered.png), [próximo passo após reiniciar o Chrome](validation-v1.11.1/startup-restored-step.png) e [recibo de abertura/reinício](validation-v1.11.1/startup-results.json). O recibo distingue a URL documentada do destino ajustado para a porta isolada de testes. As referências do plano e do README foram alinhadas à documentação atual.


O comando literal `python3 -B app.py`, com o link original de `http://127.0.0.1:8765/`, também passou em execução separada. [Resultados](validation-v1.11.1/native-startup-results.json), [comando/porta/retorno](validation-v1.11.1/native-startup-status.json) e [saída](validation-v1.11.1/native-startup.txt). A instância temporária foi encerrada após a verificação; nenhuma instância existente foi alterada.
