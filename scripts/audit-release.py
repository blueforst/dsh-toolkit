"""检查待发布源码中的密钥、个人绝对路径和公网 IP 字面量；只输出文件名与规则。"""
import ipaddress
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
rules = {
    '疑似服务密钥': re.compile(r'(?:oc_sk_|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}'),
    '私钥': re.compile(r'BEGIN [A-Z ]*PRIVATE KEY'),
    '个人绝对路径': re.compile(r'/(?:Users|var/folders)/'),
}
errors = []
count = 0
for path in root.rglob('*'):
    if not path.is_file() or any(part in {'.git', 'node_modules', 'dist', '__pycache__'} for part in path.relative_to(root).parts):
        continue
    if path.name == 'audit-release.py':
        continue
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        errors.append((str(path.relative_to(root)), '非文本文件需要单独确认'))
        continue
    count += 1
    for name, rule in rules.items():
        if rule.search(text): errors.append((str(path.relative_to(root)), name))
    for value in re.findall(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])', text):
        try: address = ipaddress.IPv4Address(value)
        except ValueError: continue
        if address.is_global: errors.append((str(path.relative_to(root)), '公网 IP 字面量'))
if errors:
    for path, rule in errors: print(f'{path}: {rule}')
    sys.exit(1)
print(f'发布内容检查通过：{count} 个文本文件。')
