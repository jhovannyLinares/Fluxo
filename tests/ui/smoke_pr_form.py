"""Crear pull request: la entrada del menú de rama y el formulario, sin crear nada en GitHub.

El repo de prueba apunta a un GitHub que no existe: la sección de PR aparece, el formulario se abre y se lee del repo
local; el botón «Crear pull request» no se pulsa (la creación se prueba en tests/integration/pr-create.test.ts).
Un segundo repo sin remoto comprueba que sin GitHub no hay sección ni entrada de PR.
"""
import subprocess

from harness import Results, branch_menu_offers, click_branch_menu_item, fluxo_session, git, make_repo, until

FAKE_ORIGIN = 'https://github.com/fluxo-prueba-no-existe-7731/prueba.git'
PORT_WITH_GITHUB = 9579
PORT_WITHOUT_GITHUB = 9583
ABSENT_ENTRY_WAIT_S = 20
results = Results()


def github_account_in_credential_manager():
    out = subprocess.run(['git', 'credential-manager', 'github', 'list'], capture_output=True, text=True).stdout.split()
    return out[0] if out else None


GITHUB_ACCOUNT = github_account_in_credential_manager()


def commit_file(repo, name, message):
    with open(f'{repo}/{name}', 'w') as fh:
        fh.write(name + '\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', message)


def seed_with_github(base):
    repo = make_repo(base, 'prueba', files=('base',))
    git(repo, 'remote', 'add', 'origin', FAKE_ORIGIN)
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    # una rama que solo existe en el remoto: su commit no lo apunta ninguna rama local
    git(repo, 'checkout', '-q', '-b', 'efimera')
    commit_file(repo, 'solo-remota.txt', 'solo remota')
    git(repo, 'update-ref', 'refs/remotes/origin/solo-remota', 'HEAD')
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'branch', '-q', '-D', 'efimera')
    git(repo, 'checkout', '-q', '-b', 'feature')
    commit_file(repo, 'trabajo.txt', 'trabajo')
    git(repo, 'update-ref', 'refs/remotes/origin/feature', 'HEAD')
    git(repo, 'config', 'branch.feature.remote', 'origin')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/feature')
    if GITHUB_ACCOUNT:
        # sin una cuenta fijada en el repo, Git Credential Manager no elige entre varias y Fluxo pide elegir una
        git(repo, 'config', 'credential.https://github.com.username', GITHUB_ACCOUNT)
    return [repo]


def seed_without_remote(base):
    repo = make_repo(base, 'sin-remoto', files=('base',))
    git(repo, 'checkout', '-q', '-b', 'feature')
    commit_file(repo, 'trabajo.txt', 'trabajo')
    return [repo]


with fluxo_session(PORT_WITH_GITHUB, 'prform', seed_with_github) as (page, base):
    page.locator('.refs-section-title', has_text='LOCALES').first.wait_for(timeout=60000)
    # la sección aparece cuando el remoto se reconoce como GitHub: antes no hay entrada de PR en el menú
    page.locator('.refs-section-title', has_text='PULL REQUESTS').first.wait_for(timeout=60000)
    to_main = 'Iniciar un pull request hacia origin/main desde origin/feature'
    results.check('sobre otra rama: «hacia origin/main desde origin/feature» (la clicada es el destino)', branch_menu_offers(page, 'main', to_main))
    click_branch_menu_item(page, 'main', to_main)

    panel = page.locator('.side-panel')
    results.check('se abre el panel «Crear un pull request»', until(lambda: panel.get_by_text('Crear un pull request').count() >= 1))
    if GITHUB_ACCOUNT:
        results.check('rama de origen origin/feature', until(lambda: panel.get_by_label('Rama de origen').input_value() == 'origin/feature'))
        results.check('el destino viene preseleccionado: origin/main', panel.get_by_label('Rama destino').input_value() == 'main')
        results.check('el título viene con el nombre de la rama', panel.get_by_label('Título').input_value() == 'feature')
        results.check('trae descripción, revisores, asignados, etiquetas y borrador', all(panel.get_by_text(t, exact=True).count() >= 1 for t in ['Descripción', 'Revisores', 'Asignados', 'Etiquetas', 'Enviar como borrador']))
        create = panel.get_by_role('button', name='Crear pull request')
        results.check('con título y la rama subida se puede crear', until(lambda: create.is_enabled()))
        panel.get_by_label('Título').fill('')
        results.check('sin título no se puede crear', create.is_disabled())
    else:
        results.skip('campos del formulario', 'no hay ninguna cuenta de GitHub en Git Credential Manager con que leer el repo')
    page.keyboard.press('Escape')
    results.check('Esc cierra el panel', until(lambda: panel.count() == 0))

    results.check('sobre la rama actual: «hacia origin desde origin/feature»', branch_menu_offers(page, 'feature', 'Iniciar un pull request hacia origin desde origin/feature'))
    page.keyboard.press('Escape')
    results.check('también sobre una rama que solo existe en el remoto', branch_menu_offers(page, 'solo-remota', 'Iniciar un pull request hacia origin/solo-remota desde origin/feature'))

with fluxo_session(PORT_WITHOUT_GITHUB, 'prnone', seed_without_remote) as (page, base):
    page.locator('.refs-section-title', has_text='LOCALES').first.wait_for(timeout=60000)
    page.locator('.ref-row', has_text='main').first.wait_for()
    results.check('sin remoto de GitHub no hay sección PULL REQUESTS', page.locator('.refs-section-title', has_text='PULL REQUESTS').count() == 0)
    results.check('ni la entrada «Iniciar un pull request» en el menú de rama', not branch_menu_offers(page, 'main', 'Iniciar un pull request', ABSENT_ENTRY_WAIT_S))

results.finish()
