import http.server, os, sys
ROOT = sys.argv[1]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def translate_path(self, path):
        import re
        p = re.sub(r'^https?://[^/]+', '', path.split('?')[0])
        if p in ('/pilgrim-details', '/spat/pilgrim-details', '/arjitha-seva/slot-booking'): return os.path.join(ROOT, 'pilgrim-details.html')   # 0.3.1: Arjitha seva reuses the form
        if p == '/srivani': return os.path.join(ROOT, 'srivani.html')
        if re.search(r'\.(js|css|png)$', p): return os.path.join(ROOT, os.path.basename(p))   # 0.3.1: assets under a deeper path (/arjitha-seva/…) still come from the mock root
        return super().translate_path(p)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
