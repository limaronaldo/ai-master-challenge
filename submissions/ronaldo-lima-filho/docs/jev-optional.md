# JEV opcional — contrato público preparado

Classifica somente texto fornecido explicitamente. Não lê CSVs, não recebe automaticamente conta, vendedor, ID ou histórico e não altera fatores, índices ou ranking. O dataset não contém notas para validar utilidade real do classificador. Autorização de implementação não autoriza dados privados ou gastos.

## Integração na oportunidade

O formulário único aparece em “Ver detalhes → Analisar nota desta oportunidade”. A seleção e os atributos do deal ficam no navegador; o contrato de `jev.py` permanece texto-only. A classificação recebe uma sugestão tática por regra local combinando categoria, etapa e fila derivada da idade/ciclo. Saneamento exige validar continuidade, qualificação exige conta/necessidade e conversão exige próximo passo ou resolução da objeção. Isso não altera índice nem filas.

Trocar de oportunidade ou fechar a revisão limpa texto, modo, confirmações e resultado. Respostas atrasadas são descartadas. Se o mesmo deal continuar visível após renderização, o formulário mantém a nota; se sair da página/filtro, ela é descartada. Não há persistência ou exportação da nota. O mock permite selecionar três exemplos fixos; seu próximo passo é marcado como demonstração. Fechar limpa também o exemplo selecionado e volta ao padrão `insufficient_context`.

## Provedor público preparado e compatibilidade local

A rota HTTP preparada usa OpenRouter (`LEADSCORER_JEV_PROVIDER=openrouter`, secret `OPENROUTER_API_KEY`), endpoint fixo `https://openrouter.ai/api/v1/systemone` e modelo `typesafe/jev-1.13`. O texto de consentimento identifica OpenRouter como intermediário e JEV/TypeSafe como modelo/provedor. O caminho direto abaixo é compatibilidade interna do adapter; ele não libera o endpoint público pago.

### Contrato TypeSafe direto conferido anteriormente em 13/10/2026

[Models](https://docs.typesafe.ai/models): identificador `jev-1.13.0`. [API HTTP](https://docs.typesafe.ai/api): `POST https://api.typesafe.ai/v1/systemone`, Bearer e corpo `model`, `state`, `questions`. [Choice](https://docs.typesafe.ai/primitives/choice): pergunta com tipo, instruções e critérios; resposta com escolha, distribuição e confiança. Usa biblioteca padrão, sem SDK. Disponibilidade da conta e inferência real não foram testadas.

O request leva apenas `state.text`. Categorias propostas localmente: `explicit_next_step`, `explicit_objection`, `insufficient_context`. Se ambos os sinais aparecem ou há ambiguidade, pede contexto insuficiente. Não são categorias oficiais do fornecedor, pontuação do lead, urgência, datas ou recomendação de contato.

## Modos e ativação

“Modo do módulo” inicia **Desativado**. Recarregar restaura esse padrão; o formulário e o resultado visível são limpos. O texto JEV não é persistido; o modo serviço mantém classificação, uso e hashes no ledger do servidor para idempotência, mesmo após fechar o formulário. Anotações do roteiro de revisão têm salvamento local separado e não são enviadas ao JEV. **Demonstração local** oferece `insufficient_context` (padrão), `explicit_next_step` e `explicit_objection` como fixtures fixas `synthetic_fixture`. O seletor preenche texto ilustrativo; mesmo que o usuário o edite, o retorno depende somente do exemplo selecionado e não interpreta texto. Confiança e probabilidades são null. Trocar de exemplo limpa o resultado e invalida respostas atrasadas.

Serviço exige todas as variáveis abaixo no servidor:

| Variável | Condição |
|---|---|
| `LEADSCORER_JEV_ENABLED` | `1` |
| `LEADSCORER_JEV_ALLOW_NETWORK` | `1` |
| `LEADSCORER_JEV_ALLOW_SPENDING` | `1` |
| `LEADSCORER_JEV_PROVIDER` | `openrouter` |
| `OPENROUTER_API_KEY` | Secret cadastrado diretamente pelo usuário, somente no servidor |
| `LEADSCORER_JEV_LEDGER_EPOCH` | UUID público do ledger, vinculado uma única vez após inicialização |

Os gates permanecem em 0 e há bloqueio adicional no código até comprovar teto financeiro. O usuário reportou cadastro do secret; o agente não leu o valor. Um volume de 1 GB foi autorizado/criado, ainda sem montagem. [Política pública, orçamento e bloqueios](jev-public-review.md). Ativação exige validação separada dos pré-requisitos. Não colocar chave na interface, CSV, pacote ou log. Não há provisionamento de conta ou cobrança.

Cada envio exige selecionar natureza `synthetic` ou `public` e confirmar transmissão via OpenRouter ao modelo JEV da TypeSafe e custo daquela requisição. Não há modo para dados privados. A declaração não comprova origem: o responsável verifica o conteúdo. Alterar texto/modo limpa confirmações e descarta resultados atrasados na UI. Uma requisição já transmitida não pode ser desfeita pela troca de modo.

## API local, entradas e saídas

`GET /api/jev/status`: modelo e disponibilidade, sem credenciais. `POST /api/jev/classify`:

```json
{"mode":"mock","mock_category":"explicit_next_step","text":"Exemplo sintético: reunião combinada.","data_classification":"synthetic","allow_transmission":false,"confirm_cost":false}
```

Campos desconhecidos e tipos inválidos são rejeitados antes do transporte. `mock_category` é opcional somente em modo mock; outras categorias ou uso em modo service/disabled são rejeitados. Mock/service exigem texto não vazio de até 4.000 caracteres. Corpo HTTP até 20.000 bytes, JSON com Content-Length.

Sem configuração, a API local aceita apenas `http://127.0.0.1:<porta>` e `http://localhost:<porta>`. Para uma origem hospedada, `LEADSCORER_ALLOWED_ORIGINS` aceita uma lista separada por vírgulas de origens HTTP(S) exatas, sem curinga, caminho, query ou barra final; por exemplo, `https://leadscorer.fly.dev`. Quando a lista não está vazia, o POST exige o cabeçalho `Origin` correspondente. Essa verificação protege o fluxo do navegador, mas **não autentica usuários nem limita custos**; clientes podem forjar cabeçalhos HTTP.

Saída: `status`, `source`, `model`, `baseline_unchanged`, `classification`, mensagem. Serviço validado: categoria, rótulo, distribuição e confiança; sem resultado, classificação null. Texto não é devolvido, salvo ou registrado no log do app. Classificação validada, uso e hashes de controle são persistidos no servidor para impedir nova cobrança em replay; nenhuma credencial ou IP cru entra no ledger. Modelo precisa corresponder ao ID fixado, categorias precisam ser conhecidas e distribuição precisa ser finita e somar aproximadamente 1. Confiança do fornecedor refere-se à pergunta de texto, não à oportunidade ou venda.

| Status | Comportamento |
|---|---|
| `disabled` | Nenhuma chamada; regras locais |
| `mock` | Fixture local identificada; sem inferência |
| `blocked` | Falta confirmação ou natureza autorizada; nenhum envio |
| `unavailable` | Configuração ausente, timeout, HTTP/rede; usar regras locais |
| `invalid_response` | Resposta rejeitada pelo contrato; usar regras locais |
| `ok` | Resultado separado, origem `openrouter_service` |

HTTPS fixo, sem redirects ou proxy de ambiente. Timeout de cinco segundos; resposta até 64 KiB; nenhum retry automático, lote ou envio após carregar, filtrar ou simular. A UI funciona com serviço indisponível.

## Limites antes de qualquer ativação real

Acesso público sem login foi autorizado. Origin e confirmações podem ser forjados e não são autenticação. A rota preparada exige controles no backend: janela persistente por cliente/global, uma única reserva em andamento globalmente, Idempotency-Key e deduplicação, validação/payload/timeout, erros sanitizados e ledger durável. Nenhum texto é enviado automaticamente.

O limite interno é US$3,50 total sem renovação, com reserva candidata de US$0,02 antes do transporte. Diferenças, timeout, erro e crash não devolvem saldo; respostas com custo divergente fecham o circuito. Época e marcador durável detectam recriação ou restauração isolada do banco. Rollback do volume inteiro ainda exige autoridade monotônica externa; o serviço real permanece bloqueado. Nenhuma consulta da chave ou inferência real foi executada.

## Testes e limites

Transporte mockado e textos sintéticos cobrem gates, payload, separação, distribuição inválida, timeout/HTTP, origem, limites e invariância do pipeline. Mock não demonstra acurácia. Nenhuma chamada de modelo, compra ou transmissão ao TypeSafe ocorreu.

[Limitações do modelo](https://docs.typesafe.ai/model-jaggedness/jev-1.13): riscos em matemática, datas, conteúdo adversarial e ordem das opções. Por isso aritmética, datas e decisões comerciais ficam locais. Sem avaliação de acurácia em português, calibração no domínio, latência do provedor, validação comercial ou garantia contra prompt injection.
