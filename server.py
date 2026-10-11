# 本地 / 容器并发开发服务器：带 no-cache 响应头，避免改代码后浏览器仍用旧缓存
# 支持环境变量覆盖：
#   HOST  默认 127.0.0.1（容器内请设 0.0.0.0）
#   PORT  默认 8642（DevStation 端口转发支持 8080-8089）
import http.server
import os

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8642"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默日志

# 浏览器的空闲预连接不能占住唯一处理线程，否则其余脚本会等待到超时。
Server = http.server.ThreadingHTTPServer

if __name__ == "__main__":
    with Server((HOST, PORT), Handler) as httpd:
        print(f"serving at http://{HOST}:{PORT}")
        httpd.serve_forever()
