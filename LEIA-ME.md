# RecrutaZen — Gerenciador de processo seletivo

O candidato continua respondendo o **Google Forms** normalmente. O RecrutaZen lê a planilha de respostas
e mostra cada resposta como um card, onde você muda o status, faz anotações e vê o currículo.

```
Google Forms ──► Planilha de respostas ──► Apps Script (dentro da planilha) ◄──► Site (GitHub Pages)
                                           guarda status, anotações e usuários
                                           em abas ocultas RZ_...
```

- `apps-script/` — o "servidor", que roda dentro da sua planilha no Google (grátis, sem PC ligado).
- `site/` — as telas do sistema, publicadas no GitHub Pages.

## 1. Instalar o Apps Script na planilha (uma vez só, ~5 minutos)

1. Abra a planilha de respostas e vá em **Extensões → Apps Script**.
2. Apague o conteúdo do arquivo `Código.gs` que aparece e cole todo o conteúdo de `apps-script/Codigo.gs`.
3. (Recomendado) Em **Configurações do projeto** (ícone de engrenagem), marque
   *"Mostrar arquivo de manifesto appsscript.json no editor"*. Volte ao editor, abra `appsscript.json`
   e substitua pelo conteúdo de `apps-script/appsscript.json`. Isso limita o acesso do script a
   **esta planilha** e à **leitura** do Drive (para abrir os currículos).
4. Clique em **Salvar** (ícone de disquete).
5. Clique em **Implantar → Nova implantação** → engrenagem ao lado de "Selecionar tipo" → **App da Web**.
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
6. Clique em **Implantar** e autorize com sua conta Google. Se aparecer "O Google não verificou este app",
   clique em **Avançado → Acessar (não seguro)**. O app é seu, então isso é esperado.
7. Copie a **URL do app da Web** (termina em `/exec`) e coloque em `site/config.js`, no campo `API_URL`.

> "Qualquer pessoa" só significa que o site consegue conversar com o script. Todas as ações exigem
> login e senha do RecrutaZen. A planilha em si continua privada.

**Logo depois de publicar, abra o site e crie o administrador** (a tela de primeiro acesso aparece
enquanto não existir nenhum usuário).

### Quando alterar o `Codigo.gs` no futuro
Em **Implantar → Gerenciar implantações → lápis (editar) → Versão: Nova versão → Implantar**.
Assim a URL continua a mesma.

## 2. Usar o sistema
- **Candidatos:** quadro com uma coluna por status (arraste os cards) ou lista ordenável. Filtros por
  status, área pretendida, bairro/cidade, idade, escolaridade, estado civil e data de inscrição. A busca
  procura em **todas as respostas**.
- **Ficha:** todas as respostas, currículo (PDF e imagem aparecem na tela; Word: baixar ou abrir no Drive),
  WhatsApp, link para a linha da planilha, anotações e histórico (quem fez, quando).
- **Status:** crie, renomeie, mude a cor e a ordem. "Inicial" é o status das novas respostas.
- **Usuários** (administrador): crie acessos e redefina senhas.
- Novas respostas aparecem sozinhas a cada 3 minutos, ou na hora pelo botão ↻.

Na primeira leitura, as linhas que estavam pintadas com as cores da legenda da planilha
(**DESCARTADOS**, **IMPRESSO**) já entram com o status correspondente.

## Cuidados
- Não renomeie nem apague as abas ocultas `RZ_...`: é nelas que ficam os status, as anotações e os usuários.
- Pode reordenar, colorir ou filtrar a aba de respostas à vontade. O sistema identifica cada candidato
  pelo arquivo do currículo, e não pela posição da linha.
- Se mudar o texto das perguntas do formulário, o sistema continua mostrando todas as respostas. Os filtros
  usam palavras-chave (nome, idade, bairro, telefone, estado civil, nascimento, área, escolaridade).
