# Preparação local para eventual PR

Este documento descreve passos futuros. Criar fork, branch, commit, push ou PR não foi executado nesta preparação. O estado “a preencher no momento do envio” deve ser atualizado apenas quando houver envio real; os registros históricos continuam datados e verdadeiros.

## Fonte do conteúdo

Usar a extração conferida do **LeadScorer-G4-local-v1.10.1.zip**, verificando o SHA-256 no arquivo `LeadScorer-G4-local-v1.10.1.zip.sha256` e o recibo `delivery-receipt-v1.10.1.json`. Esta entrega contém a implementação local 1.10.1 e suas evidências; os ZIPs 1.10, 1.9 e 1.9-docfix1 permanecem preservados com seus hashes e recibos históricos. O pacote contém somente `submissions/ronaldo-lima-filho/`. Não copiar a pasta de trabalho inteira nem incluir pacotes, caches, configurações, evidências antigas ou registros intermediários.

## Procedimento futuro

1. Criar o fork e usar uma cópia limpa dele. O checkout de preparação aponta ao upstream; não é o destino de push da submissão.
2. Criar a branch exigida pelo enunciado: `submission/ronaldo-lima-filho`.
3. Copiar somente a pasta extraída para `submissions/ronaldo-lima-filho/`.
4. O `.gitignore` oficial ignora submissões. Adicionar explicitamente apenas esta pasta com `git add -f -- submissions/ronaldo-lima-filho/`.
5. Conferir a lista e o conteúdo dos arquivos staged. Todos os caminhos devem começar por essa pasta. A alteração local no template da raiz, os entregáveis e os registros de sessão ficam fora.
6. Conferir setup, testes, links, hashes, process log e situação do teste com participantes. Atualizar o estado de envio somente quando ele ocorrer.
7. Após autorização para publicar, seguir as instruções oficiais de commit, push e PR. Título: `[Submission] Ronaldo Lima Filho — Challenge 003`.

Não usar inclusão indiscriminada de toda a árvore. A guarda de escopo e o manifesto do pacote devem ser conferidos novamente depois de qualquer edição.

## Guarda de escopo antes de um futuro commit

Executar somente na cópia limpa do fork, quando a preparação da branch/commit tiver sido autorizada. Estes comandos são instruções futuras; não foram executados no índice deste checkout.

```sh
git add -f -- submissions/ronaldo-lima-filho/
git diff --cached --name-only -z | python3 -c 'import sys; paths=[p for p in sys.stdin.buffer.read().split(b"\0") if p]; bad=[p for p in paths if not p.startswith(b"submissions/ronaldo-lima-filho/")]; print("Escopo inválido; interrompa e revise a seleção." if bad else "Escopo válido: somente a submissão."); sys.exit(1 if bad or not paths else 0)'
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check -- . ':(exclude)submissions/ronaldo-lima-filho/solution/data/metadata.csv' ':(exclude)submissions/ronaldo-lima-filho/solution/assets/OFL-Manrope.txt'
git diff --cached --stat
git diff --cached -- submissions/ronaldo-lima-filho/
```

Se a guarda falhar ou o conteúdo não corresponder à extração verificada, interromper a preparação. Não executar commit, push ou PR. Não usar comandos de limpeza, restauração, remoção ou reset para corrigir a seleção automaticamente. Revisar o índice e pedir orientação se necessário. O checkout atual contém alterações anteriores em `templates/submission-template.md`, `deliverables/` e `session-artifacts/`; elas devem ser preservadas e ficar fora da futura submissão.

Antes da cópia, conferir integridade do ZIP e todos os hashes/tamanhos do manifesto. Depois da cópia, comparar novamente os arquivos com a extração e conferir a lista staged completa — a restrição de caminhos sozinha não comprova integridade do conteúdo. A guarda usa caminhos delimitados por NUL para não confundir espaços ou quebras de linha em nomes.

A opção `cr-at-eol` vale somente para aquele comando de conferência: reconhece as terminações CRLF dos CSVs originais e exportados, sem regravar arquivos ou mudar a configuração do repositório. Os bytes dos dados devem permanecer preservados.

Os dois caminhos excluídos da conferência de whitespace são arquivos mantidos literalmente da origem: `metadata.csv` tem um espaço ao fim da descrição de Sales agent, e `OFL-Manrope.txt` tem um espaço ao fim de uma linha da licença. Ambos continuam sujeitos à conferência integral de hash/tamanho do manifesto e à guarda de escopo; a exclusão não autoriza mudanças nesses arquivos.

Fontes: [CONTRIBUTING](https://github.com/Gestao-Quatro-Ponto-Zero/ai-master-challenge/blob/main/CONTRIBUTING.md) e [Guia de Submissão](https://github.com/Gestao-Quatro-Ponto-Zero/ai-master-challenge/blob/main/submission-guide.md).
