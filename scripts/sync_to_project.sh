#!/bin/bash
# 同步到 Claude.ai Project 的提醒脚本
# 跑这个会显示当前需要上传的文件列表

cd ~/Downloads/VC\ CODE/n8n-reactivation-engine

echo "===================================="
echo "📂 Files modified in docs/ this week:"
echo "===================================="
git log --since="7 days ago" --name-only --pretty=format: docs/ | sort -u | grep -v "^$"

echo ""
echo "===================================="
echo "📋 Upload checklist:"
echo "===================================="
echo "1. Go to Claude.ai Project"
echo "2. Remove old versions of the files above"
echo "3. Upload the new versions"
echo "4. Verify Project shows recent 'modified' timestamp"