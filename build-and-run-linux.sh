#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"
dotnet restore src/RonSijm.Slopsidian.Linux --source https://api.nuget.org/v3/index.json --nologo
exec dotnet run --project src/RonSijm.Slopsidian.Linux --no-restore -- "$@"
