"""Init con proveedores: las 8 pestañas, «not connected» sin cuenta y el formulario de GitHub/Azure con cuenta.

No crea nada en ningún servidor: con las cuentas reales de Git Credential Manager solo se leen y se rellena el formulario.
"""
import subprocess

from harness import Results, fluxo_session, make_repo, until

PORT = 9578
EXPECTED_TABS = ['Solo local', 'GitHub.com', 'GitHub Enterprise Server', 'GitLab.com', 'GitLab (Self-Managed)', 'Bitbucket.org', 'Bitbucket Data Center', 'Azure DevOps']
GITHUB_FIELDS = ['Cuenta', 'Nombre', 'Descripción', 'Acceso', 'Clonar después de crear', 'Clonar en', 'Ruta completa', 'Rama por defecto']
ACCOUNTS_LOADED = "() => document.querySelector('dialog.init-modal select') && document.querySelector('dialog.init-modal select').options.length > 0"
results = Results()

with fluxo_session(PORT, 'init', lambda base: [make_repo(base, 'prueba')]) as (page, base):
    page.locator('.crumb-opt').first.wait_for(timeout=60000)
    page.locator('.crumb-opt').first.click()
    page.get_by_role('menuitem', name='Iniciar repo…').click()
    dialog = page.locator('dialog.init-modal')
    dialog.wait_for(timeout=10000)

    tabs = [t.strip() for t in dialog.locator('.gm-tab').all_inner_texts()]
    results.check('8 orígenes en la columna, como GitKraken', tabs == EXPECTED_TABS, str(tabs))

    dialog.get_by_role('button', name='GitLab.com').click()
    results.check('GitLab sin cuenta: «no está conectado» y el botón Conectar', dialog.get_by_text('GitLab.com no está conectado').count() == 1 and dialog.get_by_role('button', name='Conectar con GitLab.com').count() == 1)

    dialog.get_by_role('button', name='GitHub.com').click()
    has_account = until(lambda: dialog.get_by_label('Cuenta').count() == 1)
    if not has_account:
        results.check('GitHub sin cuentas: botón «Conectar con GitHub.com» activo', until(lambda: dialog.get_by_role('button', name='Conectar con GitHub.com').is_enabled()))
    else:
        page.wait_for_function(ACCOUNTS_LOADED, timeout=40000)
        shown = dialog.get_by_label('Cuenta').locator('option').all_inner_texts()
        stored = subprocess.run(['git', 'credential-manager', 'github', 'list'], capture_output=True, text=True).stdout.split()
        results.check('GitHub muestra las cuentas de Git Credential Manager', sorted(shown) == sorted(stored) and len(shown) > 0, f'{shown} vs {stored}')
        present = [f for f in GITHUB_FIELDS if dialog.get_by_text(f, exact=True).count() >= 1]
        results.check('campos de GitHub como GitKraken', present == GITHUB_FIELDS, str(present))
        create = dialog.get_by_role('button', name='Crear repositorio y clonar')
        results.check('sin nombre no se puede crear', create.is_disabled())
        dialog.get_by_label('Nombre', exact=True).fill('nuevo')
        results.check('con nombre y carpeta se puede crear', create.is_enabled())
        dialog.get_by_label('Nombre', exact=True).fill('con espacio:')
        results.check('un nombre inválido avisa y bloquea', create.is_disabled() and dialog.locator('.gm-problem').count() == 1)
        dialog.get_by_label('Nombre', exact=True).fill('nuevo')
        dialog.get_by_label('Clonar después de crear').uncheck()
        results.check('sin «Clone after init» desaparecen carpeta y rama y el botón cambia', dialog.get_by_text('Clonar en', exact=True).count() == 0 and dialog.get_by_text('Rama por defecto', exact=True).count() == 0 and dialog.get_by_role('button', name='Crear repositorio', exact=True).is_enabled())

    dialog.get_by_role('button', name='Azure DevOps').click()
    azure_unlinked = until(lambda: dialog.get_by_text('Azure DevOps no está conectado').count() == 1, 8)
    if azure_unlinked:
        results.check('Azure sin organización enlazada: «no está conectado» y dónde enlazarla', dialog.get_by_text('Preferencias › Cuentas').count() == 1)
    else:
        results.check('Azure con organización enlazada: cuenta y proyecto', dialog.get_by_label('Cuenta').count() == 1 and dialog.get_by_label('Proyecto').count() == 1)

    dialog.get_by_role('button', name='Solo local').click()
    results.check('Solo local vuelve al formulario de siempre', dialog.get_by_label('Cuenta').count() == 0 and dialog.get_by_role('button', name='Crear repositorio', exact=True).count() == 1)

results.finish()
