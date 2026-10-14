# Revisão operacional — versão local 1.11.1

Três melhorias acrescentam continuidade à revisão, preservando as regras determinísticas:

| Melhoria | Comportamento entregue |
|---|---|
| Próximo passo salvo | Salvamento explícito de respostas, ação, prazo opcional, estado e horário por oportunidade no navegador; recuperação após reload; até cinco versões para desfazer; exportação JSON e exclusão confirmada por base |
| Roteiro por fila | Duas perguntas específicas para conversão, saneamento ou qualificação; confirmação adicional do vínculo quando a conta é desconhecida; campos sem resposta continuam pendentes; resumo identifica respostas declaradas e origem salva/rascunho |
| Coordenação por conta/produto | Aviso e sinalização de outras abertas com a mesma conta identificada/produto e outro vendedor; alias GTXPro/GTX Pro reconciliado; navegação contextual preserva filtros e retorno |

`workflow.js` mantém validação e persistência separadas da aplicação analítica. Na versão 1.11, `app.py` acrescentou a identificação da versão e uma rota estática explícita para o módulo. Na 1.11.1, usa uma fábrica com `ThreadingHTTPServer`, vinculada ao mesmo endereço local, e fecha o servidor ao sair. O motor, `revops.py`, `jev.py`, os cinco CSVs e a análise não mudaram ante o commit de partida `aa7fe9515ae06c407bff87ea74aad45ee5e93cda`. Os ajustes posteriores ao ZIP 1.10.1 de confirmação por envio JEV e de testes HTTP estão preservados e novamente exercitados; [registro histórico](verification-pr188-p2.md).

## Aceitação verificada

- Salvar e recarregar preserva os campos locais; a marcação “Revisado nesta sessão” continua temporária e independente.
- Editar e desfazer restaura ação/estado anteriores, inclusive depois de recarregar. Digitação não grava; rascunhos sobrevivem à navegação na aba, mas não ao reload.
- Falha de quota retém o trabalho temporariamente, avisa e preserva o valor já salvo. Dados ilegíveis não são sobrescritos e entram na cópia exportada. Exclusão exige confirmação e afeta somente a base atual.
- Uma aba desatualizada detecta alteração no armazenamento e evita sobrescrever outro salvamento. Isso não é bloqueio transacional, sincronização ou controle multiusuário.
- Resumo copiado informa pendências, fatos de 2017, hash da base e origem salva/rascunho. Exportação real exclui rascunhos sem tentativa de salvamento. Textos nas evidências são sintéticos.
- Texto HTML digitado é escapado nos campos, histórico e resumo visual, inclusive após reload; não executa conteúdo.
- Coincidência de conta/produto/vendedores é conferida contra as linhas originais; não há agrupamento de órfãs nem alteração de responsável.
- Formulário cabe em 375 e 320 px. Os cenários existentes de teclado, fechamento e retorno de foco permanecem passando.

**51 testes Python, 65 Node e 69 cenários Chrome**. Evidências, ambiente e limites estão em [revops-verification.md](revops-verification.md). As 2.089 decisões originais mantêm projeção `d758d0023dff0fd18a7114a525065899db5fb243b96c19fc1268bbb1fd2e3b10`, com filas 212/1.377/500. A análise JSON foi reproduzida byte a byte.

## Limites do registro local

O prazo representa a revisão atual, separada da fotografia de 2017. Os dados são declarações manuais; não provam contato, identidade, venda ou atualização do CRM. Não há autenticação, sincronização, importação JSON ou trilha imutável. Limpeza dos dados do navegador pode remover os registros; exporte sua cópia. Armazenamento pertence à origem HTTP: porta ou nome do host diferentes não compartilham as anotações. O módulo não envia essas respostas ao JEV. O serviço real continua desativado.

## Entrega e autorização

Pacote `LeadScorer-G4-local-v1.11.1.zip`, somente `submissions/ronaldo-lima-filho/`, com README, testes, capturas e manifestos. Versões anteriores preservadas. A versão 1.11.1 foi preparada localmente a partir do ZIP 1.11 revisado; o checkout do PR e o PR remoto não foram atualizados nesta rodada. Não houve commit, push, publicação, envio, deploy, alteração de CRM ou inferência real.


## Correções 1.11.1 e reprodução

A revisão final identificou um bloqueio anterior às três melhorias: o servidor sequencial podia esperar em uma conexão aceita e ainda sem linha de requisição. A nova fábrica `create_server` usa atendimento por conexão e é compartilhada pelo comando de início e pela suíte HTTP. A regressão demonstra o erro no servidor antigo e o sucesso no corrigido para HTML, workflow.js, fonte e API, sem fechar a conexão ociosa antes das respostas.

Dois cenários Chrome adicionais percorrem a abertura real do HTML, a orientação/link e a recuperação da fila, e verificam o próximo passo Concluído após reinício completo do navegador. Em porta de teste independente, o cenário primeiro confere a URL documentada e depois ajusta somente o destino do link para a instância isolada; essa adaptação fica registrada em startup-results.json. O comando literal `python3 -B app.py` e o link original na porta 8765 também foram executados, sem ajustar a URL; ambos os cenários passaram. [Recibo do fluxo literal](validation-v1.11.1/native-startup-results.json).

A referência textual de capturas no plano usa a pasta atual. O README nomeia a seção de anotações e o documento de verificação atual. Código de interface, workflow.js, motor, política, dados e módulo JEV do ZIP 1.11 permanecem preservados. Alterações paralelas de JEV na cópia de trabalho ficam fora deste pacote. Nenhum ganho comercial, inferência real, publicação ou atualização de PR é reivindicado.
