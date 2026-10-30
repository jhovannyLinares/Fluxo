"""Create Worktree: panel con referencia, rama nueva opcional y carpeta por defecto <repo>.worktrees/<nombre>."""
import os

from harness import Results, click_branch_menu_item, fluxo_session, git, make_repo, until

PORT = 9577
results = Results()


def seed(base):
    repo = make_repo(base, 'prueba', files=('c1', 'c2'))
    git(repo, 'branch', 'otra', 'HEAD~1')
    return [repo]


def open_worktree_panel(page, branch):
    click_branch_menu_item(page, branch, f'Crear worktree desde {branch}')
    page.locator('.side-panel').wait_for(timeout=8000)


def folder(page):
    return page.get_by_label('Carpeta de trabajo').input_value().replace(chr(92), '/')


with fluxo_session(PORT, 'worktree', seed) as (page, base):
    repo = os.path.join(base, 'prueba')
    page.locator('.refs-section-title', has_text='LOCALES').first.wait_for(timeout=60000)

    open_worktree_panel(page, 'otra')
    reference = page.get_by_label('Referencia a sacar')
    results.check('muestra la referencia y la carpeta por defecto <repo>.worktrees/<rama>', reference.input_value() == 'otra' and folder(page).endswith('prueba.worktrees/otra'), f'{reference.input_value()} | {folder(page)}')
    results.check('la referencia es solo lectura', reference.get_attribute('readonly') is not None)
    page.get_by_label('Rama del worktree a crear').fill('trabajo-nuevo')
    results.check('la carpeta sigue el nombre de la rama nueva', folder(page).endswith('prueba.worktrees/trabajo-nuevo'), folder(page))
    page.get_by_role('button', name='Crear worktree', exact=True).click()
    created = os.path.join(base, 'prueba.worktrees', 'trabajo-nuevo')
    results.check('al crear, ofrece abrir el worktree (como GitKraken)', until(lambda: page.get_by_text('¿Quieres abrir el worktree «trabajo-nuevo» ahora?').count() >= 1))
    page.keyboard.press('Escape')
    results.check('crea el worktree en la rama nueva', until(lambda: os.path.isdir(created) and git(created, 'branch', '--show-current').strip() == 'trabajo-nuevo'))
    results.check('la rama nueva sale de «otra»', git(repo, 'rev-parse', 'trabajo-nuevo').strip() == git(repo, 'rev-parse', 'otra').strip())
    results.check('aparece en el panel de worktrees', until(lambda: page.locator('.ref-row', has_text='trabajo-nuevo').count() >= 1))

    open_worktree_panel(page, 'main')
    page.get_by_label('Rama del worktree a crear').fill('otra')
    page.get_by_role('button', name='Crear worktree', exact=True).click()
    alert = page.locator('.side-panel [role=alert]')
    results.check('una rama que ya existe se rechaza dentro del panel', until(lambda: alert.count() == 1) and 'ya existe' in alert.inner_text().lower())
    page.keyboard.press('Escape')

    tabs_before = page.locator('[role=tab]').count()
    open_worktree_panel(page, 'main')
    page.get_by_label('Rama del worktree a crear').fill('ultimo')
    page.get_by_role('button', name='Crear worktree', exact=True).click()
    page.get_by_role('button', name='Abrir en una pestaña nueva').click()
    results.check('«Abrir en una pestaña nueva» abre el worktree como repo', until(lambda: page.locator('[role=tab]').count() == tabs_before + 1))

results.finish()
