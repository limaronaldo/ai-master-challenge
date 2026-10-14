# Correção visual — versão local 1.10.1

O botão “Ação de conversão” do painel do gestor ficava estreito no desktop e dividia a palavra “conversão”. A correção reserva duas partes da linha para o comando e uma para contagem/janela. O texto pode ocupar mais de uma linha, mas cada palavra permanece inteira.

A implementação JavaScript dos fluxos, o motor, os CSVs, os pesos, os limites e a classificação permanecem iguais. app.py muda somente a identificação de versão. A suíte de navegador acrescenta uma verificação real de geometria de cada palavra em todos os cartões visíveis a 1440, 1024, 861, 375 e 320 px, incluindo ausência de overflow horizontal.

48 testes Python, 38 Node e 37 cenários Chrome; evidências desta rodada em [revops-verification.md](revops-verification.md). [Medições dos botões](validation-v1.10.1/manager-label-layout.json), [captura desktop](validation-v1.10.1/desktop-manager-shortcuts.png) e [captura móvel](validation-v1.10.1/mobile-manager-shortcuts.png).

Projeção original das 2.089 decisões preservada: `d758d0023dff0fd18a7114a525065899db5fb243b96c19fc1268bbb1fd2e3b10`. Filas 212/1.377/500; análise JSON reproduzida byte a byte. Pacote somente sob submissions/ronaldo-lima-filho/, com README, manifestos e sidecar SHA-256 atualizados. O ZIP 1.10 e seus recibos permanecem preservados. Nenhum commit, push, PR, publicação ou envio foi realizado.
