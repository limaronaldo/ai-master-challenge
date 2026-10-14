# PR 188 — correções P2 posteriores ao pacote 1.10.1

Patch mínimo sobre `1f139a5583c7316eb14ad4cf3abbbdcde87065ca`, autorizado pelo usuário. O ZIP 1.10.1 original e suas verificações/manifestos históricos permanecem preservados. Esta verificação descreve o estado posterior; os hashes do ZIP antigo não identificam o código corrigido.

## Mudanças

- JEV service desmarca ambas as confirmações no `finally` de cada tentativa, inclusive falhas de rede/timeout, HTTP, indisponibilidade e resposta inválida. O resultado permanece disponível. O token da interação protege confirmações novas contra respostas tardias; o handler bloqueia submissão enquanto o botão estiver desativado. Disabled/mock e score-base permanecem separados.
- O teste HTTP preserva o ambiente e força somente os três gates JEV para `0`. A regressão monta um proxy 403 local, instala previamente o opener com HTTP_PROXY/NO_PROXY e verifica respostas corretas, ausência de acessos ao proxy/provedor e restauração do ambiente/opener.
- O destino das capturas Chrome aceita `LEADSCORER_TEST_OUT`, para evitar reescrever a rodada histórica de 1.10.1.

## Verificação executada

49 testes Python, 53 Node e 55 cenários Chrome passaram. São 1 regressão Python, 15 Node e 18 cenários Chrome novos. O Chrome instalado no Mac foi executado via Playwright em headless; os cenários novos exercitaram 1440 e 375 px. A suíte existente também verificou 1024, 861 e 320 px. Não houve repetição manual adicional no navegador.

Os casos service cobrem sucesso, erro/timeout de rede sintético, erro HTTP, indisponibilidade, JSON inválido e resposta inválida; exigem ambas as confirmações em cada repetição. Node verifica respostas tardias de sucesso/erro após texto, modo e oportunidade, e resposta antiga durante uma nova requisição; Chrome verifica os três caminhos em desktop/mobile, incluindo fechar e voltar ao detalhe. Disabled/mock e a ordem-base permanecem cobertos. Não houve chamada real ao serviço JEV: todos os resultados service foram mocks, e a rede externa foi bloqueada no processo. Zero chamadas pagas.

Comandos da suíte (a partir de `solution/`, com gates JEV desativados e ambiente sem credenciais):

```sh
rtk proxy python3 -B -m unittest discover -v
rtk proxy node --test test_ui.cjs
rtk proxy node --check test_browser.cjs
rtk proxy node test_browser.cjs
```

Para Chrome, um servidor local com `HTTPServer(("127.0.0.1", 0), Handler)` forneceu a porta em `LEADSCORER_URL`; Playwright já estava instalado e acessível em `NODE_PATH`. `LEADSCORER_TEST_OUT` apontou para uma pasta nova de evidências. O runner usou `sandbox-exec`, negou rede externa e acesso ao diretório pessoal fora da cópia de execução/dependências, permitindo loopback e arquivos temporários do Chrome. Sondas confirmaram bloqueio de leitura/escrita fora do escopo e conexão externa. Todos os processos e servidores foram encerrados. Limites de tempo: 120 s Python/Node, 180 s Chrome; sem quota rígida de memória/processos.

A primeira preparação isolada omitiu `docs/source-manifest.json`, causando um erro de arquivo ausente; a cópia foi corrigida e a suíte completa passou. Os logs dessa primeira tentativa e do runner final permanecem nos artefatos locais, separados dos resultados publicados abaixo.

## Preservação e evidências

Os cinco CSVs, app.py, revops.py, jev.py, análise, política, regras e documentação histórica continuam byte a byte iguais ao commit anterior. A projeção das 2.089 oportunidades mantém `d758d0023dff0fd18a7114a525065899db5fb243b96c19fc1268bbb1fd2e3b10`, com filas 212/1.377/500. Os testes continuam excluindo encerradas da fila e resultados de fechamento do cálculo. O ZIP original mantém `48a6ec1b8164f102617d11a2f2b10ebf1bf85047d0412147cf2c750735450fb5`.

[Recibo e hashes](validation-pr188-p2/verification-receipt.json), [comandos reais e saídas](validation-pr188-p2/commands.json), [Python](validation-pr188-p2/python.log), [Node](validation-pr188-p2/node.log), [Chrome](validation-pr188-p2/browser-results.json), [captura móvel](validation-pr188-p2/jev-single-use-consent-mobile.png).
