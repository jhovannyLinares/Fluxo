"""Arnés común de las pruebas de humo de la interfaz de Fluxo (Electron + Playwright por CDP).

Cada prueba pide una sesión con `fluxo_session(...)`: carpeta temporal, `recents.json` sembrado, Electron aislado
(`--user-data-dir`), conexión por CDP y limpieza al salir. Las esperas son por condición (`until`), nunca por tiempo fijo.
Solo lo visual o interactivo va aquí; la lógica se prueba con vitest.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager

from playwright.sync_api import sync_playwright

FLUXO_DIR = os.environ.get('FLUXO_DIR', r'C:\Tools\output\Fluxo')
STARTUP_TIMEOUT_S = 90
DEFAULT_TIMEOUT_S = 40
POLL_INTERVAL_S = 0.4
VIEWPORT = {'width': 1500, 'height': 900}
GIT_IDENTITY = ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.com']


def git(repo, *args):
    """Corre git en `repo` y devuelve stdout; los errores se ven en el resultado de la prueba, no se lanzan."""
    return subprocess.run(['git', '-C', repo, *GIT_IDENTITY, *args], capture_output=True, text=True).stdout


def make_repo(base, name, files=('uno', 'dos')):
    """Repo con un commit por archivo, en la rama `main`. La ruta es la real (git informa la larga, no la 8.3)."""
    repo = os.path.join(base, name)
    subprocess.run(['git', 'init', '-q', '-b', 'main', repo], check=True)
    for f in files:
        with open(os.path.join(repo, f + '.txt'), 'w') as fh:
            fh.write(f + '\n')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-qm', f)
    return repo


def until(condition, secs=DEFAULT_TIMEOUT_S):
    """Espera a que `condition()` sea verdadera, hasta `secs`. Una excepción cuenta como «todavía no»."""
    deadline = time.time() + secs
    while time.time() < deadline:
        try:
            if condition():
                return True
        except Exception:
            pass
        time.sleep(POLL_INTERVAL_S)
    return False


def branch_menu_offers(page, branch, item_name, secs=DEFAULT_TIMEOUT_S):
    """Abre el menú ⋮ de la fila de `branch` y dice si ofrece `item_name`.

    Al arrancar, el panel de ramas se recarga varias veces y cierra el menú: se reabre hasta que la entrada esté o
    se acabe el tiempo (una entrada que no debe estar tarda `secs` en darse por ausente).
    """
    item = page.get_by_role('menuitem', name=item_name)

    def menu_has_item():
        if item.count() == 0:
            row = page.locator('.ref-row', has_text=branch).first
            row.hover()
            row.locator('.ref-more').dispatch_event('click')
        return item.count() >= 1

    return until(menu_has_item, secs)


def click_branch_menu_item(page, branch, item_name):
    """Pulsa `item_name` en el menú ⋮ de la fila de `branch`."""
    if not branch_menu_offers(page, branch, item_name):
        raise RuntimeError(f'El menú de «{branch}» no ofrece «{item_name}»')
    page.get_by_role('menuitem', name=item_name).first.click()


class Results:
    """Acumula las comprobaciones, las imprime al momento y decide el código de salida."""

    def __init__(self):
        self.items = []

    def check(self, name, ok, extra=''):
        self.items.append((name, bool(ok), extra))
        print('OK  ' if ok else 'FALLA', name, extra, flush=True)

    def skip(self, name, why):
        """Una comprobación que esta máquina no puede hacer: se dice, no cuenta como fallo ni como éxito."""
        print('SALTADA', name, '—', why, flush=True)

    def finish(self):
        failed = [i for i in self.items if not i[1]]
        print('\nRESUMEN:', len(self.items) - len(failed), 'ok,', len(failed), 'fallan')
        sys.exit(1 if failed else 0)


def _cdp_ready(port):
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=2).read()
        return True
    except OSError:
        return False


def _app_page(browser):
    pages = [pg for ctx in browser.contexts for pg in ctx.pages if pg.url.startswith(('http', 'file'))]
    return pages[0] if pages else None


@contextmanager
def fluxo_session(port, prefix, repos=lambda base: [], extra_env=None):
    """Abre Fluxo con los repos que devuelve `repos(base)` como recientes; entrega `(page, base)`.

    `repos` recibe la carpeta temporal para crear los repos de la prueba. Al salir se cierra Electron y se borra todo.
    """
    base = os.path.realpath(tempfile.mkdtemp(prefix=f'fluxo-{prefix}-'))
    user_data = os.path.join(base, 'userdata')
    os.makedirs(user_data)
    paths = repos(base)
    now_ms = int(time.time() * 1000)
    recents = {'version': 1, 'repos': [{'path': p, 'name': os.path.basename(p), 'openedAt': now_ms} for p in paths]}
    with open(os.path.join(user_data, 'recents.json'), 'w') as fh:
        json.dump(recents, fh)
    env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    env.update(extra_env or {})
    exe = os.path.join(FLUXO_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
    proc = subprocess.Popen([exe, FLUXO_DIR, f'--remote-debugging-port={port}', f'--user-data-dir={user_data}'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not until(lambda: _cdp_ready(port), STARTUP_TIMEOUT_S):
            raise RuntimeError(f'Electron no abrió el puerto {port} en {STARTUP_TIMEOUT_S} s')
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
            if not until(lambda: _app_page(browser) is not None, STARTUP_TIMEOUT_S):
                raise RuntimeError('La ventana de Fluxo no apareció')
            page = _app_page(browser)
            page.set_viewport_size(VIEWPORT)
            yield page, base
            browser.close()
    finally:
        proc.terminate()
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], capture_output=True)
        shutil.rmtree(base, ignore_errors=True)
