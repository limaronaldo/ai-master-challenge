"""Isolated hosted demo adapter; original scoring/data modules stay unchanged."""
import os
import json
from urllib.parse import urlsplit
import app

SOURCE_COMMIT = '6c4766306e52d1659806da5eed541a78deda0610'
SOURCE_PATCH = 'pr188-public-jev-guard-review-20261015'
DATA_HASH = 'c5a0244edc0ccd97307ee4ac88fff5cae566bb411f9b3e11fcaf8d43827828f3'
PROJECTION_HASH = 'd758d0023dff0fd18a7114a525065899db5fb243b96c19fc1268bbb1fd2e3b10'


def disable_hosted_jev(environ):
    for key in ('LEADSCORER_JEV_ENABLED', 'LEADSCORER_JEV_ALLOW_NETWORK', 'LEADSCORER_JEV_ALLOW_SPENDING'):
        environ[key] = '0'
    environ['LEADSCORER_JEV_PROVIDER'] = 'openrouter'
    environ.pop('TYPESAFE_API_KEY', None)
    environ.pop('OPENROUTER_API_KEY', None)


disable_hosted_jev(os.environ)


def public_origin(value):
    if not value:
        return None
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or '*' in parsed.netloc):
        raise ValueError('Use an exact HTTPS Origin without path, credentials or wildcard')
    return value


class DemoHandler(app.Handler):
    def end_headers(self):
        if not any(line.lower().startswith(b'x-content-type-options:') for line in self._headers_buffer):
            self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/healthz':
            self.json_response(self.server.health)
            return
        if path in ('/', '/index.html'):
            text = (app.ROOT / 'index.html').read_text()
            text = text.replace('LEAD SCORER · DEMONSTRAÇÃO LOCAL', 'LEAD SCORER · DEMONSTRAÇÃO HOSPEDADA')
            text = text.replace('Confira se o servidor Python continua aberto e se os CSVs estão na pasta data. Se houver um erro no terminal, confira a mensagem antes de tentar novamente.', 'A demonstração hospedada não conseguiu carregar os dados. Tente novamente; revisões são temporárias nesta aba e não atualizam o CRM.')
            # Keep local-file help unchanged; hosted HTTP errors must not ask visitors to start Python.
            start = text.index('        <ol>\n', text.index('<section id="server-help"'))
            end = text.index('      </section>', start)
            text = text[:start] + '<p>Confira sua conexão e tente carregar novamente. Nenhum registro foi alterado.</p>\n' + text[end:]
            content = text.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(content)
            return
        super().do_GET()



class DemoServer(app.BoundedHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, origin=None):
        self.public_origin = public_origin(origin)
        data = app.dataset()
        projection = [{k: row[k] for k in ('id', 'position', 'score', 'urgency', 'age', 'value_points')}
                      | {'factor_points': [f['points'] for f in row['factors']]} for row in data['rows']]
        if data['dataset_hash'] != DATA_HASH or app.fingerprint(projection) != PROJECTION_HASH:
            raise ValueError('Snapshot differs from reviewed source')
        self.health = {'status': 'ok', 'source_commit': SOURCE_COMMIT, 'source_patch': SOURCE_PATCH,
                       'dataset_hash': DATA_HASH,
                       'open_rows': len(data['rows']), 'queue_counts': data['queue_counts'], 'jev_real_enabled': False}
        super().__init__(address, DemoHandler)



if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    if not 1 <= port <= 65535:
        raise ValueError('PORT must be between 1 and 65535')
    host = os.environ.get('LEADSCORER_BIND', '0.0.0.0')
    if host not in ('0.0.0.0', '127.0.0.1', 'localhost'):
        raise ValueError('Unsupported bind address')
    server = DemoServer((host, port), os.environ.get('LEADSCORER_PUBLIC_ORIGIN'))
    print(json.dumps(server.health), flush=True)
    server.serve_forever()
