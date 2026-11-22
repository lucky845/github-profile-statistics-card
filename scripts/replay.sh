#!/usr/bin/env bash
# 两档 replay，回答两个不同的问题。
#
#   ./scripts/replay.sh          全量 153 条，基线 148/153。问"录制行为有没有漂移"——
#                                依赖上游实时数据（GitHub/CSDN/力扣…），会随网络和配额波动。
#   ./scripts/replay.sh gate     106 条纯本地，必须 106/106。问"我这一改有没有搞坏东西"——
#                                不打上游、不吃配额、不看日期，CI 里就该跑这一档。
#   ./scripts/replay.sh home     单个 case
#
# 为什么全量必须钉时钟：卡片 footer 是 `更新于 {format_date_now()}`
# （crates/svg/src/port.rs:213），录制时把 2026-11-21 写死进了 25 个 .body。
# 日期一过这 25 条全挂：2026-11-22 直接跑是 127/153。
# RUST_ANYTHING_WTS_OVERRIDE（crates/svg/src/port.rs:181，单位秒）是现成的注入点。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2

RECORDED_AT=1795219200  # 2026-11-21T00:00:00Z
BASELINE_PASSED=148
TOTAL_CASES=153
GATE_TOTAL=106

# 绝对路径：gate 的 corpus 在临时目录里，相对路径的二进制在那儿找不到。
# REPLAY_APP_BIN 可覆盖——CI 里构建的是 release，没必要为跑 gate 再编一份 debug。
APP_BIN="${REPLAY_APP_BIN:-${REPO_ROOT}/target/debug/app}"
BUILD_CMD="env RUST_ANYTHING_WTS_OVERRIDE=${RECORDED_AT} ${APP_BIN}"

if [ ! -x "${APP_BIN}" ]; then
  echo "找不到 ${APP_BIN}，先构建: cargo build --bin app"
  exit 2
fi

mode="${1:-all}"

# --- gate: 派生一个只含"不依赖上游"case 的临时 corpus ---
# 排除两类：
#   image/svg  (46 条) 每张卡片都要打上游，GitHub 匿名配额 60/小时，CSDN 还会 521。
#   cache-stats (1 条) 上报本次 run 的 hits/misses/keys，天然依赖跑过哪些 case。
if [ "$mode" = "gate" ]; then
  corpus=$(mktemp -d)
  trap 'rm -rf "$corpus"' EXIT
  mkdir -p "$corpus/rust/app-cases/http"
  cp rust/app-cases/rust-anything.json "$corpus/rust/app-cases/"
  kept=0
  for toml in rust/app-cases/http/*.toml; do
    name=$(basename "$toml" .toml)
    if grep -q "image/svg" "$toml"; then continue; fi
    if [ "$name" = "cache-stats" ]; then continue; fi
    cp "$toml" "$corpus/rust/app-cases/http/"
    body="${toml%.toml}.body"
    [ -f "$body" ] && cp "$body" "$corpus/rust/app-cases/http/"
    kept=$((kept + 1))
  done
  if [ "$kept" -ne "$GATE_TOTAL" ]; then
    echo "gate 子集应含 ${GATE_TOTAL} 条，实际 ${kept} 条——case 目录被动过？"
    exit 2
  fi
  echo "[gate] ${GATE_TOTAL} 条纯本地 case，不钉时钟也稳定，必须全绿"
  echo
  rust-anything app replay "$corpus" --build "$BUILD_CMD" --timeout 300
  status=$?
  passed=$(sed -n 's/^Passed: *\([0-9]*\)\/\([0-9]*\)$/\1/p' "$corpus/rust/app-cases/replay-report.md" 2>/dev/null | head -1)
  echo
  if [ -n "${passed:-}" ] && [ "$passed" -lt "$GATE_TOTAL" ]; then
    echo "[FAIL] gate 通过 ${passed}/${GATE_TOTAL}。这是回归。"
    echo "       逐条 diff: $corpus/rust/app-cases/replay-report.md"
    trap - EXIT
    exit 1
  fi
  [ -n "${passed:-}" ] && echo "[ok] gate ${passed}/${GATE_TOTAL} 全绿。"
  exit $status
fi

# --- 全量 / 单 case ---
# 匿名 GitHub 配额用尽时，github 相关 case 会渲染成限流错误卡（11 条），那不是回归。
# JSON 里 "core" 与 "remaining" 不在同一行，sed 按行处理永远匹配不到——必须先 tr 压成一行。
remaining=$(curl -s -m 10 https://api.github.com/rate_limit \
  | tr -d ' \n' | sed -n 's/.*"core":{[^}]*"remaining":\([0-9]*\).*/\1/p')
if [ -n "${remaining:-}" ] && [ "$remaining" -lt 20 ]; then
  echo "[warn] GitHub 匿名配额仅剩 ${remaining}/60，github 卡片可能渲染成限流错误卡。"
  echo "       需要干净结果时先设 GITHUB_TOKEN（5000/小时），或用 ./scripts/replay.sh gate。"
  echo
fi

args=(. --build "$BUILD_CMD" --timeout 300)
if [ "$mode" != "all" ]; then
  args+=(--case "$mode")
fi

echo "[replay] 时钟钉在 2026-11-21 (epoch ${RECORDED_AT})，基线 ${BASELINE_PASSED}/${TOTAL_CASES}"
echo
rust-anything app replay "${args[@]}"
status=$?

report="rust/app-cases/replay-report.md"
if [ -f "$report" ] && [ "$mode" = "all" ]; then
  passed=$(sed -n 's/^Passed: *\([0-9]*\)\/\([0-9]*\)$/\1/p' "$report" | head -1)
  echo

  # 全量档靠"失败集合"判定，不靠分数。原因是它会随上游波动：
  #   - 5 条 HIT->MISS 是录制工具的采样副作用，必然失败；
  #   - trap-112 的 CSDN 用户会随 CSDN 回 521 而渲染成"暂无数据"错误卡，
  #     同样的代码连跑两次就能给出 148 和 147 两种分数。
  # 所以分数不是判据，集合才是：失败全在这些已知条目里 = 无回归；
  # 冒出任何一条新的 = 真的坏了。分数只作为信息打印。
  KNOWN_FAILS="csdn-user leetcode-user trap-111-get-csdn trap-112-get-csdn trap-117-get-csdn trap-120-get-csdn"
  unexpected=""
  for name in $(grep '^### ' "$report" | sed 's/^### //'); do
    case " $KNOWN_FAILS " in
      *" $name "*) ;;
      *) unexpected="$unexpected $name" ;;
    esac
  done

  if [ -n "$unexpected" ]; then
    echo "[FAIL] 出现已知集合之外的失败:$unexpected"
    echo "       这是回归，不是上游波动。逐条 diff 见 ${report}"
    exit 1
  fi

  echo "[ok] 通过 ${passed}/${TOTAL_CASES}；失败全部落在已知的 6 条上游/采样差异内，无新回归。"
  # rust-anything 自己会因为那几条已知差异返回非零；判定已经由上面的集合比较给出。
  exit 0
fi

exit $status
