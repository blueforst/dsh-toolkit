#!/usr/bin/env python3
"""下载固定版本并验证摘要，不通过 npm 安装第二套 DSH 运行时。"""
import base64
import hashlib
import json
import pathlib
import tarfile
import tempfile
import urllib.request

root = pathlib.Path(__file__).resolve().parent
assets = json.loads((root / "assets.json").read_text())

for name, spec in assets.items():
    algorithm = "sha256" if name == "driver" else "sha512"
    expected = spec.get("sha256") or base64.b64decode(spec["integrity"].split("-", 1)[1]).hex()
    with tempfile.TemporaryDirectory() as temporary:
        archive = pathlib.Path(temporary) / "asset.tgz"
        digest = hashlib.new(algorithm)
        size = 0
        with urllib.request.urlopen(spec["url"], timeout=120) as response, archive.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if digest.hexdigest() != expected or ("size" in spec and size != spec["size"]):
            raise RuntimeError(f"{name} 下载校验失败")
        destination = root / name
        destination.mkdir(exist_ok=True)
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                relative = pathlib.PurePosixPath(member.name)
                if relative.is_absolute() or ".." in relative.parts or member.issym() or member.islnk():
                    raise RuntimeError("下载归档包含不安全路径")
                if name == "provider":
                    if not relative.parts or relative.parts[0] != "package":
                        raise RuntimeError("非预期的 npm 包目录")
                    member.name = str(pathlib.PurePosixPath(*relative.parts[1:]))
                    if member.name == ".":
                        continue
                tar.extract(member, destination, filter="data")
        print(f"{name} {spec['version']} 摘要验证通过")

# 官方 provider 复用固定基础镜像的 Cordis、MCP 与 computer-use 服务。
(root / "provider/node_modules").symlink_to(
    "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules", target_is_directory=True
)
