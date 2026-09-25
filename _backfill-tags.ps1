$ErrorActionPreference = "Continue"
$proj = "D:\AI\DeepSeek Harness Workspace\sillytavern-shell"
$bp = @(
  @{ ver = "2.2.16"; commit = "4d6d454" },
  @{ ver = "2.2.17"; commit = "ab12099" },
  @{ ver = "2.2.18"; commit = "ff8fc18" },
  @{ ver = "2.2.19"; commit = "5975f1d" },
  @{ ver = "2.2.20"; commit = "2340298" },
  @{ ver = "2.2.21"; commit = "2340298" }
)
$env:GH_CONFIG_DIR = "$env:APPDATA\GitHub CLI"
$authUrl = $env:DSH_PUSH_URL
if (-not $authUrl) { Write-Output "NO_PUSH_URL"; exit 2 }
foreach ($b in $bp) {
  $tag = "v" + $b.ver
  $pkgTxt = git -C $proj show ($b.commit + ":package.json") 2>$null
  $have = ($pkgTxt | ConvertFrom-Json).version
  if ($have -ne $b.ver) { Write-Output ("SKIP " + $tag + " : commit version is " + $have); continue }
  $exists = git -C $proj rev-parse --verify --quiet ("refs/tags/" + $tag)
  if (-not $exists) {
    git -C $proj tag -a $tag $b.commit -m ($tag + " - audit fixes for " + $b.ver) | Out-Null
    Write-Output ("TAGGED " + $tag + " -> " + $b.commit + " (shell " + $have + ")")
  } else { Write-Output ("TAG-EXISTS " + $tag) }
  git -C $proj remote set-url origin $authUrl
  $env:GIT_TERMINAL_PROMPT = "0"
  $out = git -C $proj -c http.sslVerify=false push origin $tag 2>&1 | Out-String
  git -C $proj remote set-url origin "https://github.com/Anarrogantcat/sillytavern-shell.git"
  Write-Output ("PUSHED " + $tag + " exit=" + $LASTEXITCODE + " :: " + (($out -replace "\s+", " ").Trim()))
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 20
    $j = curl.exe -sS -k -m 30 --noproxy "*" ("https://api.github.com/repos/Anarrogantcat/sillytavern-shell/releases/tags/" + $tag) | ConvertFrom-Json
    if ($j.tag_name) {
      $names = ($j.assets | ForEach-Object { $_.name }) -join ","
      Write-Output ("RELEASED " + $tag + " draft=" + $j.draft + " assets=" + $names)
      $ok = $true
      break
    }
  }
  if (-not $ok) { Write-Output ("TIMEOUT-WAIT " + $tag) }
}
Write-Output "BATCH-DONE"