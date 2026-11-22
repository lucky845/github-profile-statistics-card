#!/usr/bin/env bash
# 复现录制基线：钉死时钟后跑 153 条 HTTP case。
#
# 为什么必须钉时钟：卡片 footer 是 `更新于 {format_date_now()}`（crates/svg/src/port.rs:213），
# 录制时把 2026-11-21 写死进了 25 个 .body。不钉时钟，日期一过这 25 条全挂：
# 2026-11-22 直接跑是 127/153，而基线是 148/153。
#
# RUST_ANYTHING_WTS_OVERRIDE 是 crates/svg/src/port.rs:181 已有的时钟注入点（秒）。
#
# 用法: ./scripts/replay.sh            # 全量
#       ./scripts/replay.sh home       # 单个 case
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2

RECORDED_AT=1795219200  # 2026-11-21T00:00:00Z
BASELINE_PASSED=148
TOTAL_CASES=153

BUILD_CMD="env RUST_ANYTHING_WTS_OVERRIDE=${RECORDED_AT} target/debug/app"

if [ ! -x target/debug/app ]; then
  echo "找不到 target/debug/app，先构建: cargo build --bin app"
  exit 2
fi

# 匿名 GitHub 配额用尽时，github 相关 case 会渲染成限流错误卡（11 条），那不是回归。
# 提前说清楚，免得下一个人照着 diff 去改代码。
remaining=$(curl -s -m 10 https://api.github.com/rate_limit \
  | sed -n 's/.*"core".*"remaining": *\([0-9]*\).*/\1/p' | head -1)
if [ -n "${remaining:-}" ] && [ "$remaining" -lt 20 ]; then
  echo "[warn] GitHub 匿名配额仅剩 ${remaining}/60，github 卡片可能渲染成限流错误卡。"
  echo "       需要干净结果时先设 GITHUB_TOKEN（5000/小时）。"
  echo
fi

echo "[replay] 时钟钉在 2026-11-21 (epoch ${RECORDED_AT})，基线 ${BASELINE_PASSED}/${TOTAL_CASES}"
echo

args=(. --build "$BUILD_CMD" --timeout 300)
if [ $# -gt 0 ]; then
  args+=(--case "$1")
fi

rust-anything app replay "${args[@]}"
status=$?

report="rust/app-cases/replay-report.md"
if [ -f "$report" ] && [ $# -eq 0 ]; then
  passed=$(sed -n 's/^Passed: *\([0-9]*\)\/\([0-9]*\)$/\1/p' "$report" | head -1)
  echo
  if [ -n "${passed:-}" ] && [ "$passed" -lt "$BASELINE_PASSED" ]; then
    echo "[FAIL] 通过 ${passed}/${TOTAL_CASES}，低于基线 ${BASELINE_PASSED}。这是回归，不是差一点。"
    echo "       逐条 diff 见 ${report}"
    exit 1
  fi
  if [ -n "${passed:-}" ]; then
    echo "[ok] 通过 ${passed}/${TOTAL_CASES}，基线 ${BASELINE_PASSED} 达成。"
  fi
fi

exit $status
