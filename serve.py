"""Static file server for development.

Plain http.server lets the browser hold on to old modules, which shows up
as a change that was made but cannot be seen. Everything is served
no-store so what is on screen is always what is on disk.
"""

import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    # Threading matters: a browser holds connections open, and a
    # single-threaded server stops answering the moment it does.
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        print("Dream World running at http://localhost:%d/" % PORT)
        print("Close this window to stop it.")
        httpd.serve_forever()
