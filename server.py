# 本地开发服务器：带 no-cache 响应头，避免改代码后浏览器仍用旧缓存
import http.server
import socketserver

PORT = 8642

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默日志

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"serving at http://127.0.0.1:{PORT}")
        httpd.serve_forever()
