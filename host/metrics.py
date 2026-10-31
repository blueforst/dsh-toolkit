"""宿主机整机资源采样；只提供聚合数值，不暴露进程或环境信息。"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import threading
import time

snapshot = None
lock = threading.Lock()

def cpu():
    values = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
    return sum(values[:8]), values[3] + values[4]

def sample():
    global snapshot
    previous = cpu()
    while True:
        time.sleep(1)
        try:
            current = cpu()
            total_delta = current[0] - previous[0]
            busy = 100 * (1 - (current[1] - previous[1]) / total_delta) if total_delta > 0 else 0
            previous = current
            memory = {}
            for line in Path('/proc/meminfo').read_text().splitlines():
                name, value = line.split(':', 1)
                memory[name] = int(value.split()[0]) * 1024
            memory_total = memory['MemTotal']
            memory_used = memory_total - memory['MemAvailable']
            disk = os.statvfs(os.environ.get('DSH_METRICS_DISK', '/'))
            disk_total = disk.f_blocks * disk.f_frsize
            disk_used = (disk.f_blocks - disk.f_bfree) * disk.f_frsize
            data = {
                'scope': 'host',
                'timestamp': round(time.time() * 1000),
                'cpu': {'percent': round(max(0, min(100, busy)), 2), 'cores': os.cpu_count()},
                'memory': {'percent': round(memory_used / memory_total * 100, 2), 'used': memory_used, 'total': memory_total},
                'disk': {'percent': round(disk_used / disk_total * 100, 2), 'used': disk_used, 'total': disk_total},
            }
            with lock:
                snapshot = data
        except (OSError, ValueError, KeyError):
            continue

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/metrics':
            self.send_error(404)
            return
        with lock:
            data = snapshot
        body = json.dumps(data or {'error': '采样正在初始化'}).encode()
        self.send_response(200 if data else 503)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass

threading.Thread(target=sample, daemon=True).start()
ThreadingHTTPServer((os.environ.get('DSH_METRICS_BIND', '127.0.0.1'), int(os.environ.get('DSH_METRICS_PORT', '9191'))), Handler).serve_forever()
