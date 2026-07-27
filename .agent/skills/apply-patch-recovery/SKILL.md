---
name: apply-patch-recovery
description: 在本项目 Windows/PowerShell 环境中，已观察到 apply_patch.bat 对多行补丁发生参数转发或补丁解析失败时使用。不要用于权限拒绝、路径不存在、补丁上下文不匹配、codex.exe 自身失败或缺少写入授权。
---

# Windows apply_patch 恢复

## 原则

仅恢复已确认由 `apply_patch.bat` 多行参数转发引起的补丁失败。继续使用补丁协议；不要改用 `Set-Content`、重定向或其他 shell 写入方式，也不要把本流程当作权限绕过。

## 恢复步骤

1. 保留原始错误。仅当已观察到 `apply_patch`/`apply_patch.bat` 对多行补丁的转发或解析失败时继续。
2. 通过当前包装脚本动态解析 `codex.exe`，不要硬编码安装路径。
3. 将补丁文本统一为 LF，并以单一参数直接调用 `--codex-run-as-apply-patch`。
4. 立即读取目标文件或检查 `git diff -- <target>`，确认实际变更与预期一致。

```powershell
$applyPatchWrapper = (Get-Command apply_patch -CommandType Application).Source
$wrapperText = Get-Content -LiteralPath $applyPatchWrapper -Raw

if ($wrapperText -notmatch '"([^\"]*codex\.exe)"') {
  throw "无法从 apply_patch 包装脚本解析 codex.exe 路径"
}

$codexExe = $Matches[1]
$patch = @'
*** Begin Patch
...
*** End Patch
'@
$patch = $patch -replace "`r`n", "`n"
& $codexExe --codex-run-as-apply-patch ($patch.TrimEnd([char[]]"`r`n"))
```

## 停止条件

- 包装脚本不存在、不是 `.bat`，或无法唯一解析 `codex.exe`：停止并报告。
- 错误是权限拒绝、目标路径问题、补丁上下文不匹配、`codex.exe` 本身失败或写入范围未经授权：不要使用本恢复流程。
- 直接调用退出非零，或写后验证不符合预期：停止写入并报告原始输出和已验证的文件状态。
