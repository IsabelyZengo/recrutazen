# ==========================================================================
#  RecrutaZen - atualiza o Apps Script da planilha com o codigo do GitHub
#  Uso no PowerShell (pode colar direto na janela):
#    [Net.ServicePointManager]::SecurityProtocol='Tls12'; irm https://raw.githubusercontent.com/IsabelyZengo/recrutazen/main/ferramentas/atualizar-apps-script.ps1 | iex
#  Se o PC nao tiver Node.js, ele baixa a versao portatil sozinho (sem senha de administrador).
# ==========================================================================
& {
  $ErrorActionPreference = 'Continue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $env:npm_config_update_notifier = 'false'
  $env:npm_config_fund = 'false'

  $SCRIPT_ID = '1Cgwd_2yiBTw9d9rf4NBn8809FSBJKoY_qz5zI7atRhmdJ7V3Okb3eO7t'
  $DEPLOY_ID = 'AKfycbz-gNb0lXgjwEXeWlFs_cOYTMBoNLb1dgUkl6jwc8l4iLYYkq9XKyqMWtu6arwh7w'
  $REPO      = 'https://api.github.com/repos/IsabelyZengo/recrutazen/contents/apps-script'
  $CLASP     = '@google/clasp@3.4.1'
  $origem    = Get-Location

  try {
    Write-Host ''
    Write-Host '=== RecrutaZen: atualizar o Apps Script ===' -ForegroundColor Cyan
    # Node.js: se nao estiver instalado, usa a versao PORTATIL (zip oficial do nodejs.org).
    # Nao instala nada no Windows e NAO precisa de senha de administrador.
    $pastaNode = Join-Path $env:LOCALAPPDATA 'RecrutaZen-Node'
    $nodeLocal = Get-ChildItem $pastaNode -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'npx.cmd') } | Select-Object -First 1
    if ($nodeLocal) { $env:Path = $nodeLocal.FullName + ';' + $env:Path }
    if ($env:RZ_NODE_PORTATIL -eq '1' -or -not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
      Write-Host ''
      Write-Host '[0/4] Baixando o Node.js portatil (so desta vez, uns 30 MB, sem senha de administrador)...' -ForegroundColor Yellow
      $versoes = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
      $lts = $versoes | Where-Object { $_.lts } | Select-Object -First 1
      $arq = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
      $nome = "node-$($lts.version)-$arq"
      New-Item -ItemType Directory -Force -Path $pastaNode | Out-Null
      $zip = Join-Path $pastaNode "$nome.zip"
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$($lts.version)/$nome.zip" -OutFile $zip
      Write-Host '      Descompactando...'
      Expand-Archive -Path $zip -DestinationPath $pastaNode -Force
      Remove-Item $zip -Force
      $ProgressPreference = 'Continue'
      $env:Path = (Join-Path $pastaNode $nome) + ';' + $env:Path
      if (-not (Test-Path (Join-Path (Join-Path $pastaNode $nome) 'npx.cmd'))) { throw 'nao consegui preparar o Node.js portatil.' }
      Write-Host "      Node.js $($lts.version) pronto."
    }

    $pasta = Join-Path $env:LOCALAPPDATA 'RecrutaZen-AppsScript'
    New-Item -ItemType Directory -Force -Path $pasta | Out-Null
    Set-Location $pasta

    # 1. Codigo mais recente do GitHub
    Write-Host ''
    Write-Host '[1/4] Baixando o codigo mais recente do GitHub...'
    $manifestoAntes = if (Test-Path 'appsscript.json') { Get-Content 'appsscript.json' -Raw } else { '' }
    foreach ($arq in @('Codigo.gs', 'appsscript.json')) {
      try {
        Invoke-WebRequest -UseBasicParsing -Headers @{ Accept = 'application/vnd.github.raw' } -Uri "$REPO/$arq" -OutFile (Join-Path $pasta $arq)
      } catch {
        throw "nao foi possivel baixar $arq ($($_.Exception.Message))"
      }
    }
    $manifestoAgora = Get-Content 'appsscript.json' -Raw
    ('{"scriptId":"' + $SCRIPT_ID + '","rootDir":"."}') | Set-Content -Encoding ASCII '.clasp.json'
    if ($env:RZ_TESTE -eq '1') { Write-Host 'Modo teste: parando antes do login.'; return }

    # 2. Login no Google (so na primeira vez neste computador)
    Write-Host ''
    if (-not (Test-Path (Join-Path $env:USERPROFILE '.clasprc.json'))) {
      Write-Host '[2/4] Primeiro uso: o navegador vai abrir. Entre na conta Google DONA DA PLANILHA e clique em Permitir.' -ForegroundColor Yellow
      & npx.cmd -y $CLASP login
      if ($LASTEXITCODE -ne 0) { throw 'o login nao foi concluido. Rode de novo.' }
    } else {
      Write-Host '[2/4] Login do Google ja feito neste computador.'
    }

    # 3. Envia o codigo
    Write-Host ''
    Write-Host '[3/4] Enviando o codigo para o Apps Script...'
    & npx.cmd -y $CLASP push -f
    if ($LASTEXITCODE -ne 0) {
      throw 'o envio falhou. Confira se a opcao "API Google Apps Script" esta ATIVADA em https://script.google.com/home/usersettings e rode de novo.'
    }

    # 4. Nova versao na MESMA implantacao (a URL do sistema nao muda)
    Write-Host ''
    Write-Host '[4/4] Publicando a nova versao (mesma URL)...'
    $desc = 'RecrutaZen ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
    $saida = (& npx.cmd -y $CLASP create-version $desc 2>&1 | Out-String)
    Write-Host $saida
    $m = [regex]::Match($saida, '(?i)created version (\d+)')
    if (-not $m.Success) { $m = [regex]::Match($saida, '(?i)\bversion\s+(\d+)') }
    if (-not $m.Success) { throw 'nao consegui criar a nova versao do script.' }
    & npx.cmd -y $CLASP update-deployment $DEPLOY_ID -V $m.Groups[1].Value -d $desc
    if ($LASTEXITCODE -ne 0) { throw 'nao consegui atualizar a implantacao.' }

    Write-Host ''
    Write-Host 'PRONTO! Codigo atualizado e publicado na mesma URL.' -ForegroundColor Green

    # Permissoes novas (ex.: salvar curriculos no Drive) precisam de 1 autorizacao no editor
    if ($manifestoAntes -ne $manifestoAgora) {
      Write-Host ''
      Write-Host 'ATENCAO - falta 1 autorizacao do Google (so desta vez):' -ForegroundColor Yellow
      Write-Host '  O editor do Apps Script vai abrir no navegador.'
      Write-Host '  1. No topo, escolha a funcao  doGet  e clique em  Executar.'
      Write-Host '  2. Clique em Revisar permissoes > sua conta > Avancado > Acessar > Permitir.'
      Write-Host '  Enquanto isso nao for feito, o sistema pode mostrar erro de permissao.'
      & npx.cmd -y $CLASP open-script
    }
    Write-Host ''
    Write-Host 'No sistema, aperte Ctrl+F5.'
  } catch {
    Write-Host ''
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  } finally {
    Set-Location $origem
  }
}
