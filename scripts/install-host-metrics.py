"""为 Docker 部署安装宿主资源采样服务；可先用 --dry-run 查看配置。"""
import argparse
import grp
import ipaddress
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--network', help='DSH 所在的 Docker 网络名称')
parser.add_argument('--bind', help='手动指定该 Docker 网桥的 IPv4 地址')
parser.add_argument('--port', type=int, default=9191)
parser.add_argument('--disk', default='/')
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
if not 1 <= args.port <= 65535:
    parser.error('端口必须在 1 到 65535 之间')
if not args.bind:
    if not args.network:
        parser.error('请提供 --network 或 --bind')
    network = json.loads(subprocess.check_output(['docker', 'network', 'inspect', args.network], text=True))[0]
    args.bind = next((item['Gateway'] for item in network['IPAM']['Config'] if ':' not in item.get('Gateway', ':')), None)
if not args.bind:
    parser.error('Docker 网络没有 IPv4 网关')
address = ipaddress.IPv4Address(args.bind)
if address.is_unspecified or address.is_global or address.is_multicast:
    parser.error('请使用本机回环地址或 Docker 私有网桥地址')
if any(character.isspace() for character in args.disk) or not args.disk.startswith('/'):
    parser.error('磁盘路径必须是没有空白字符的绝对路径')
account = pwd.getpwnam('nobody')
group = grp.getgrgid(account.pw_gid).gr_name
ordering = 'Requires=docker.service\nAfter=docker.service' if args.network else 'After=network.target'
unit = f'''[Unit]
Description=DSH Toolkit 宿主资源采样
{ordering}

[Service]
Type=simple
User=nobody
Group={group}
Environment=DSH_METRICS_BIND={args.bind}
Environment=DSH_METRICS_PORT={args.port}
Environment=DSH_METRICS_DISK={args.disk}
ExecStart=/usr/bin/python3 /usr/local/libexec/dsh-toolkit-metrics.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_UNIX

[Install]
WantedBy=multi-user.target
'''
if args.dry_run:
    print(unit)
else:
    if os.geteuid() != 0:
        parser.error('实际安装需要以 root 或 sudo 运行；预览可使用 --dry-run')
    source = Path(__file__).resolve().parents[1] / 'host/metrics.py'
    target = Path('/usr/local/libexec/dsh-toolkit-metrics.py')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    target.chmod(0o755)
    Path('/etc/systemd/system/dsh-toolkit-metrics.service').write_text(unit)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'dsh-toolkit-metrics.service'], check=True)
    print(json.dumps({'采样地址': f'http://{args.bind}:{args.port}/metrics', '运行用户': 'nobody'}, ensure_ascii=False))
