#!/usr/bin/env python3
"""通过已有 broker 打开持久化浏览器，不启动第二个配置档。"""
import urllib.request

request = urllib.request.Request("http://127.0.0.1:9222/json/new?about:blank", method="PUT")
with urllib.request.urlopen(request, timeout=90) as response:
    response.read()
