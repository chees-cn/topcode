#!/usr/bin/env bash
# TopCode 双远程推送脚本（CLAUDE.md §0「Git 双远程与发行规则」的唯一执行入口）
#
# 用法:
#   scripts/push-all.sh            # 仅推送分支: main → Gitee, public(剥离内部文档) → GitHub
#   scripts/push-all.sh v0.5.5     # 推送分支 + 按版本号打 tag 并推送双远程
#
# 内容边界: 内部工程文档禁止进入 GitHub; Gitee 全量接收。
set -euo pipefail

INTERNAL_DOCS=(CLAUDE.md 开发日志.md 发现日志.md 工程开发说明书.md 研究纲领.md)
VERSION="${1:-}"

# ── 1. main 全量 → Gitee（主仓）────────────────────────────
echo "▶ push main → gitee"
git push gitee main

# ── 2. 合成 public 提交（剥离内部文档）──────────────────────
# 用 commit-tree 合成「父提交 = 上一个 public」的线性历史，避免 force-push。
echo "▶ build public (internal docs stripped)"
TMPIDX=$(mktemp)
trap 'rm -f "$TMPIDX"' EXIT
GIT_INDEX_FILE="$TMPIDX" git read-tree main
GIT_INDEX_FILE="$TMPIDX" git rm -r --cached --quiet --ignore-unmatch "${INTERNAL_DOCS[@]}"
TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
MSG="public: sync from main $(git log -1 --format='%h %s' main)"
if git rev-parse --verify -q public >/dev/null; then
  COMMIT=$(git commit-tree "$TREE" -p public -m "$MSG")
else
  COMMIT=$(git commit-tree "$TREE" -m "$MSG")
fi
git update-ref refs/heads/public "$COMMIT"

# ── 3. public → GitHub main ────────────────────────────────
echo "▶ push public → origin(main)"
git push origin public:main

# ── 4. 版本 tag → 双远程 ───────────────────────────────────
if [ -n "$VERSION" ]; then
  echo "▶ tag $VERSION → gitee + github"
  git tag -f -a "$VERSION" -m "TopCode $VERSION" main
  git push -f gitee "$VERSION"
  # GitHub 的 tag 必须指向不含内部文档的 public 提交（轻量 tag ref）
  git push -f origin "$COMMIT:refs/tags/$VERSION"
fi

echo "✔ dual push complete${VERSION:+ (tag $VERSION)}"
