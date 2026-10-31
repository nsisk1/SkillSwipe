#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen

# SkillSwipe uses MongoDB. The unused PostgreSQL scaffold has no schema to
# reconcile; never run drizzle push (or force a database change) after merges.
