Set-Location "C:\Users\shekar\Desktop\shekar\RTS\cv-tailor"

Write-Host "=== Step 1: Stash chunk-37 files ===" -ForegroundColor Cyan
git stash push --include-untracked -m "chunk-37-work" -- agent/src/jobhuntz_agent/config.py agent/src/jobhuntz_agent/runner.py agent/src/jobhuntz_agent/adapters agent/tests/test_greenhouse_adapter.py
if ($LASTEXITCODE -ne 0) { Write-Host "STASH FAILED (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Step 2: Checkout chunk-37-greenhouse-adapter ===" -ForegroundColor Cyan
git checkout chunk-37-greenhouse-adapter
if ($LASTEXITCODE -ne 0) { Write-Host "CHECKOUT FAILED (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Step 3: Pop stash ===" -ForegroundColor Cyan
git stash pop
if ($LASTEXITCODE -ne 0) {
    Write-Host "STASH POP had conflicts or failed (exit $LASTEXITCODE)" -ForegroundColor Yellow
    Write-Host "Checking status..." -ForegroundColor Yellow
    git status
    # Keep stash version for any conflicts
    git checkout --theirs agent/src/jobhuntz_agent/config.py 2>$null
    git checkout --theirs agent/src/jobhuntz_agent/runner.py 2>$null
    git add agent/src/jobhuntz_agent/config.py agent/src/jobhuntz_agent/runner.py 2>$null
    Write-Host "Conflicts resolved (kept stash version)" -ForegroundColor Yellow
}

Write-Host "`n=== Status after pop ===" -ForegroundColor Cyan
git status

Write-Host "`n=== Step 4: Stage files ===" -ForegroundColor Cyan
git add agent/src/jobhuntz_agent/config.py agent/src/jobhuntz_agent/runner.py agent/src/jobhuntz_agent/adapters/ agent/tests/test_greenhouse_adapter.py
if ($LASTEXITCODE -ne 0) { Write-Host "ADD FAILED (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Staged diff summary ===" -ForegroundColor Cyan
git diff --cached --stat

Write-Host "`n=== Step 5: Commit ===" -ForegroundColor Cyan
git commit -m "Chunk 37: Greenhouse ATS adapter, dry-run fill, 36 tests"
if ($LASTEXITCODE -ne 0) { Write-Host "COMMIT FAILED (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Commit result ===" -ForegroundColor Green
git log --oneline -3
