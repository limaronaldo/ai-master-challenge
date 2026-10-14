# Preparação local para futura atualização do PR

O [PR #188](https://github.com/Gestao-Quatro-Ponto-Zero/ai-master-challenge/pull/188) já existe. Esta rodada prepara somente o **ZIP 1.11.1 local**, a partir do ZIP 1.11 revisado, derivado do commit `aa7fe9515ae06c407bff87ea74aad45ee5e93cda`, incluindo os ajustes anteriores do JEV. As alterações paralelas posteriores da cópia de trabalho não foram incorporadas. O PR e sua cópia de trabalho foram preservados. Não foi criado outro PR nem publicada esta versão.

## Fonte do conteúdo

Usar a extração conferida do **LeadScorer-G4-local-v1.11.1.zip**, verificando o SHA-256 em `LeadScorer-G4-local-v1.11.1.zip.sha256` e o recibo `delivery-receipt-v1.11.1.json`. O pacote contém somente `submissions/ronaldo-lima-filho/`, com implementação, README, testes e evidências atuais. Versões anteriores permanecem preservadas. Não copiar toda a pasta de trabalho, arquivos temporários, ZIPs ou anotações pessoais do navegador.

## Procedimento futuro, somente após autorização

1. Conferir o estado remoto do PR #188 e a branch existente `submission/ronaldo-lima-filho` no fork. Não criar PR duplicado. Se o head tiver mudado, reconciliar as alterações antes de copiar.
2. Em uma cópia limpa de preparação, comparar o conteúdo atual com a extração verificada e preservar qualquer mudança posterior. Esta geração local não modificou a branch do PR.
3. Copiar somente a pasta extraída para `submissions/ronaldo-lima-filho/`. O `.gitignore` oficial ignora submissões: adicionar explicitamente apenas essa pasta, conforme a guarda abaixo.
4. Conferir conteúdo staged, testes, links, hashes e process log. Todos os caminhos devem começar pela pasta da submissão. Template da raiz, entregáveis e registros de sessão ficam fora.
5. Revisar a descrição do PR para refletir a versão 1.11.1 e seus limites. Commit, push e atualização do PR precisam de autorização específica; não foram executados nesta rodada. Registrar o envio desta versão somente quando ocorrer.

## Guarda de escopo antes de um futuro commit

Executar somente na cópia limpa do fork, quando a preparação da branch/commit tiver sido autorizada. Estes comandos são instruções futuras; não foram executados no índice deste checkout.

```sh
git add -f -- submissions/ronaldo-lima-filho/
git diff --cached --name-only -z | python3 -c 'import sys; paths=[p for p in sys.stdin.buffer.read().split(b"\0") if p]; bad=[p for p in paths if not p.startswith(b"submissions/ronaldo-lima-filho/")]; print("Escopo inválido; interrompa e revise a seleção." if bad else "Escopo válido: somente a submissão."); sys.exit(1 if bad or not paths else 0)'
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check -- . ':(exclude)submissions/ronaldo-lima-filho/solution/data/metadata.csv' ':(exclude)submissions/ronaldo-lima-filho/solution/assets/OFL-Manrope.txt'
git diff --cached --stat
git diff --cached -- submissions/ronaldo-lima-filho/
```

Se a guarda falhar ou o conteúdo não corresponder à extração verificada, interromper a preparação. Não executar commit, push ou atualização do PR. Não usar comandos de limpeza, restauração, remoção ou reset para corrigir a seleção automaticamente. Revisar o índice e pedir orientação se necessário. O checkout atual contém alterações anteriores em `templates/submission-template.md`, `deliverables/` e `session-artifacts/`; elas devem ser preservadas e ficar fora da futura submissão.

Antes da cópia, conferir integridade do ZIP e todos os hashes/tamanhos do manifesto. Depois da cópia, comparar novamente os arquivos com a extração e conferir a lista staged completa — a restrição de caminhos sozinha não comprova integridade do conteúdo. A guarda usa caminhos delimitados por NUL para não confundir espaços ou quebras de linha em nomes.

A opção `cr-at-eol` vale somente para aquele comando de conferência: reconhece as terminações CRLF dos CSVs originais e exportados, sem regravar arquivos ou mudar a configuração do repositório. Os bytes dos dados devem permanecer preservados.

Os dois caminhos excluídos da conferência de whitespace são arquivos mantidos literalmente da origem: `metadata.csv` tem um espaço ao fim da descrição de Sales agent, e `OFL-Manrope.txt` tem um espaço ao fim de uma linha da licença. Ambos continuam sujeitos à conferência integral de hash/tamanho do manifesto e à guarda de escopo; a exclusão não autoriza mudanças nesses arquivos.

Fontes: [CONTRIBUTING](https://github.com/Gestao-Quatro-Ponto-Zero/ai-master-challenge/blob/main/CONTRIBUTING.md) e [Guia de Submissão](https://github.com/Gestao-Quatro-Ponto-Zero/ai-master-challenge/blob/main/submission-guide.md).
