# Lunarcord

Aplicativo experimental para Windows com salas, chamada de áudio/vídeo, compartilhamento de tela e chat.

Na versão 2.0, o botão **Configurações** permite escolher microfone, saída de som, câmera e a tela ou janela transmitida. A câmera e o microfone são inicializados separadamente para que a falha de um não bloqueie o outro.

Também estão incluídos cadastro, senha criptografada, verificação de e-mail, amigos, servidores, convites, cargos e permissões.

## Verificação de e-mail

Para teste local, o código aparece na tela e no terminal. Para envio real, defina antes de iniciar: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e, opcionalmente, `SMTP_FROM`. Antes de publicar, defina também uma chave longa em `LUNARCORD_JWT_SECRET` e use HTTPS.

## Rodar no seu computador

1. Instale o Node.js LTS: https://nodejs.org/
2. Abra esta pasta no terminal.
3. Execute `npm install`.
4. Execute `npm start`.

Para testar, abra uma segunda janela e entre com outro nome no mesmo código de sala.

## Gerar instalador do Windows

Execute `npm run build:win`. O instalador aparecerá na pasta `dist`.

## Usar entre computadores diferentes

O arquivo `client/app.js` está configurado para o servidor local em `http://localhost:3000`. Para amigos entrarem pela internet, publique a pasta `server` em um serviço Node.js e troque esse endereço pela URL HTTPS recebida. Em uma versão pública, adicione autenticação, moderação, TURN e banco de dados.

## Limitação desta primeira versão

O app usa conexão WebRTC direta e é mais indicado para salas pequenas. O servidor apenas coordena a entrada e o chat; ele não grava as chamadas.
