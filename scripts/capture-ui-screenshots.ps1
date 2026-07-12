param(
  [string]$BaseUrl = "http://127.0.0.1:5899",
  [string]$OutputDir = "output/playwright/ui-regression",
  [string]$Session = "hyper-ui-regression",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$routes = @(
  @{ Name = "agent"; Path = "/agent" },
  @{ Name = "settings-models"; Path = "/settings?section=models" },
  @{ Name = "settings-knowledge"; Path = "/settings?section=knowledge" },
  @{ Name = "runtime"; Path = "/runtime" },
  @{ Name = "reports"; Path = "/reports" },
  @{ Name = "alphazoo"; Path = "/alphazoo" }
)

$viewports = @(
  @{ Name = "desktop"; Width = 1440; Height = 1100 },
  @{ Name = "mobile"; Width = 390; Height = 844 }
)

$themes = @("light", "dark")

function Invoke-PwCli {
  param([string[]]$ArgsList)

  $cmd = @("npx", "--yes", "--package", "@playwright/cli", "playwright-cli", "-s=$Session") + $ArgsList
  if ($DryRun) {
    Write-Host ($cmd -join " ")
    return
  }
  & $cmd[0] $cmd[1..($cmd.Length - 1)]
}

function To-SafeName {
  param([string]$Value)
  return ($Value -replace '[^A-Za-z0-9_.-]', '-').Trim('-')
}

if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

Invoke-PwCli @("open", $BaseUrl)

foreach ($viewport in $viewports) {
  Invoke-PwCli @("resize", [string]$viewport.Width, [string]$viewport.Height)

  foreach ($theme in $themes) {
    $darkValue = if ($theme -eq "dark") { "true" } else { "false" }
    Invoke-PwCli @(
      "eval",
      "localStorage.setItem('qa-theme', '$theme'); document.documentElement.classList.toggle('dark', $darkValue);"
    )

    foreach ($route in $routes) {
      $url = "$BaseUrl$($route.Path)"
      $file = Join-Path $OutputDir "$(To-SafeName $route.Name)-$($viewport.Name)-$theme.png"
      Invoke-PwCli @("goto", $url)
      Invoke-PwCli @("run-code", "await page.waitForTimeout(800)")
      Invoke-PwCli @("screenshot", "--filename", $file, "--full-page")
    }
  }
}

Invoke-PwCli @("close")

if (-not $DryRun) {
  Write-Host "Screenshots saved to $OutputDir"
}

