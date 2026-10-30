import type { Language } from './i18n'

/** Una sección de la ayuda: título y puntos. */
export interface HelpSection {
  title: string
  items: string[]
}

/** B8: guía corta de uso (Ayuda ▸ Guía de uso), para quien no estuvo en el desarrollo. */
export const GUIDE: Record<Language, HelpSection[]> = {
  es: [
    {
      title: 'Abrir un repositorio',
      items: [
        'Archivo ▸ Abrir repositorio (Ctrl+O) o Clonar (Ctrl+N).',
        'Cada repo va en su pestaña: Ctrl+T abre una nueva, Ctrl+W la cierra y Ctrl+Tab cambia entre ellas.'
      ]
    },
    {
      title: 'Leer el grafo',
      items: [
        '↑ ↓ (o K J) recorren los commits; Shift + ↑ ↓ siguen la rama.',
        'Clic en un commit muestra su detalle a la derecha; clic en un archivo abre su diff.',
        'Shift o Ctrl + clic seleccionan varios commits; el clic derecho ofrece ver sus cambios juntos.'
      ]
    },
    {
      title: 'Buscar',
      items: [
        'Ctrl+F busca commits por mensaje, autor o SHA; con «archivo:» delante, por ruta.',
        'Ctrl+Shift+H busca un archivo y muestra los commits que lo tocaron, con su diff y el blame.',
        'Ctrl+P abre la paleta de comandos: cualquier acción del menú, ir a una rama o abrir un repo reciente.'
      ]
    },
    {
      title: 'Lo que Fluxo escribe en el repo',
      items: [
        'Pull (botón Pull), cherry pick y squash, desde el clic derecho de un commit.',
        'Doble clic sobre una rama, en el grafo o en el panel, cambia a ella; si es remota, crea la local que la sigue.',
        'Push sube la rama actual: sin upstream pregunta a dónde; si el remoto tiene commits que tú no, ofrece Pull o Force Push con confirmación.',
        'En la fila WIP: stage o quitar del stage por archivo (al pasar el ratón) o de todo, y commit con su resumen; «amend» corrige el último commit y avisa si ya estaba subido. Ctrl+Enter hace el commit.',
        'Cada escritura revisa antes si se puede; si no, la entrada sale en gris con el motivo.',
        'El resto de las escrituras (ramas, stash, descartar cambios) se ven en gris hasta la v1.2.'
      ]
    },
    {
      title: 'Cuentas y problemas',
      items: [
        'Preferencias ▸ Cuentas muestra las cuentas de Git Credential Manager y permite iniciar o cerrar sesión.',
        'El avatar arriba a la derecha es la cuenta de GitHub con que trabaja el repo de la pestaña: clic para elegir otra; queda guardada en ese repo. Si un pull o push falla por acceso, el aviso ofrece la cuenta que sí entra o renovar el SSO de la organización.',
        'Ayuda ▸ Entorno de git revisa git, credenciales y proxy.',
        'Ayuda ▸ Registro de errores (o «Ver registro» en un aviso) abre fluxo.log: cada escritura de Fluxo con su repo, rama y HEAD antes y después, los comandos de git y los errores, en orden.'
      ]
    }
  ],
  en: [
    {
      title: 'Open a repository',
      items: ['File ▸ Open Repository (Ctrl+O) or Clone (Ctrl+N).', 'Each repo goes in its own tab: Ctrl+T opens one, Ctrl+W closes it and Ctrl+Tab switches.']
    },
    {
      title: 'Read the graph',
      items: [
        '↑ ↓ (or K J) move through commits; Shift + ↑ ↓ follow the branch.',
        'Click a commit to see its details on the right; click a file to open its diff.',
        'Shift or Ctrl + click select several commits; right-click offers their combined changes.'
      ]
    },
    {
      title: 'Search',
      items: [
        'Ctrl+F finds commits by message, author or SHA; with «file:» first, by path.',
        'Ctrl+Shift+H finds a file and shows the commits that touched it, with their diff and blame.',
        'Ctrl+P opens the command palette: any menu action, go to a branch or open a recent repo.'
      ]
    },
    {
      title: 'What Fluxo writes to the repo',
      items: [
        'Pull (Pull button), cherry pick and squash, from a commit’s right-click menu.',
        'Double-click a branch, in the graph or the panel, to switch to it; a remote one creates the local branch that tracks it.',
        'Push uploads the current branch: with no upstream it asks where to; if the remote has commits you lack, it offers Pull or a confirmed Force Push.',
        'On the WIP row: stage or unstage a file (on hover) or everything, and commit with its summary; «amend» rewrites the last commit and warns if it was already pushed. Ctrl+Enter commits.',
        'Every write checks first whether it can run; if not, the entry is greyed out with the reason.',
        'Other writes (branches, stash, discard changes) stay greyed out until v1.2.'
      ]
    },
    {
      title: 'Accounts and problems',
      items: [
        'Preferences ▸ Accounts shows the Git Credential Manager accounts and lets you sign in or out.',
        'The avatar at the top right is the GitHub account the tab’s repo works with: click to pick another; it is saved in that repo. If a pull or push fails for access, the notice offers the account that gets in or renewing the organization’s SSO.',
        'Help ▸ Git Environment checks git, credentials and proxy.',
        'Help ▸ Error Log (or «View log» on a notice) opens fluxo.log: every Fluxo write with its repo, branch and HEAD before and after, the git commands and the errors, in order.'
      ]
    }
  ]
}

/** B8: notas de la versión (Ayuda ▸ Notas de la versión): lo que trae esta versión. */
export const RELEASE_NOTES: Record<Language, HelpSection[]> = {
  es: [
    {
      title: 'Repositorios en vivo',
      items: [
        'El grafo se actualiza solo cuando cambia el repo, también con cambios hechos desde la terminal o por un agente, y la fila WIP muestra los archivos editados sin commit.',
        'Varios repos en pestañas, con los recientes y el último abierto al arrancar; todas las pestañas se vigilan y volver a una es instantáneo.',
        'Fetch automático, ramas con lo que falta por subir y por bajar, y aviso de merge, rebase o cherry pick en curso.',
        'Pull requests de GitHub y Azure DevOps en el panel izquierdo, y abrir un commit, una rama o su PR en la web.'
      ]
    },
    {
      title: 'Revisar cambios',
      items: [
        'Detalle de cada commit con sus archivos, y diff en línea o lado a lado.',
        'Historial de un archivo con su diff por commit y blame (Ctrl+Shift+H).',
        'Buscar commits (Ctrl+F) y paleta de comandos (Ctrl+P).',
        'Comparar un commit con el directorio de trabajo, y ver los cambios juntos de varios commits.'
      ]
    },
    {
      title: 'Acciones',
      items: [
        'Pull con sus tres modos, cherry pick y squash, cada uno con su revisión previa.',
        'Push de la rama actual y cambio de rama con doble clic, como en GitKraken.',
        'Commit desde la fila WIP, con stage por archivo y amend.',
        'Preferencias ▸ Cuentas, sobre Git Credential Manager: Fluxo no guarda tokens.'
      ]
    },
    {
      title: 'Personalización',
      items: [
        'Cinco diseños del grafo y tres juegos de colores para las etiquetas.',
        'Temas en archivos: los de Fluxo en .json y temas externos en .jsonc, desde la carpeta de temas.',
        'Resaltar las filas de una rama al pasar el ratón sobre ella en el panel.',
        'Tema claro y oscuro, idioma español o inglés, formato de la fecha y nombres en la barra de herramientas.',
        'Paneles que se ensanchan arrastrando su borde, y columnas del grafo desde la cabecera.'
      ]
    },
    {
      title: 'Seguridad',
      items: [
        'Abrir en VS Code o en la terminal no pasa la ruta por la línea de comandos.',
        'El registro de errores (Ayuda ▸ Registro de errores) tapa los usuarios y tokens que aparezcan en una URL.'
      ]
    }
  ],
  en: [
    {
      title: 'Live repositories',
      items: [
        'The graph updates on its own when the repo changes, including changes made from the terminal or by an agent, and the WIP row shows files edited but not committed.',
        'Several repos in tabs, with recent repos and the last one reopened at startup; every tab is watched and switching back is instant.',
        'Automatic fetch, branches with what is left to push and to pull, and a notice when a merge, rebase or cherry pick is in progress.',
        'GitHub and Azure DevOps pull requests in the left panel, and open a commit, a branch or its PR on the web.'
      ]
    },
    {
      title: 'Reviewing changes',
      items: [
        'Details of each commit with its files, and inline or side-by-side diff.',
        'File history with each commit’s diff and blame (Ctrl+Shift+H).',
        'Find commits (Ctrl+F) and command palette (Ctrl+P).',
        'Compare a commit with the working directory, and view the combined changes of several commits.'
      ]
    },
    {
      title: 'Actions',
      items: [
        'Pull with its three modes, cherry pick and squash, each with a check first.',
        'Push of the current branch and branch switching by double-click, as in GitKraken.',
        'Commit from the WIP row, with per-file staging and amend.',
        'Preferences ▸ Accounts, on top of Git Credential Manager: Fluxo does not store tokens.'
      ]
    },
    {
      title: 'Customization',
      items: [
        'Five graph designs and three color sets for the labels.',
        'Themes in files: Fluxo themes in .json and external themes in .jsonc, from the themes folder.',
        'Highlight the rows of a branch when hovering over it in the panel.',
        'Light and dark theme, Spanish or English, date format and names in the toolbar.',
        'Panels you resize by dragging their edge, and graph columns from the header.'
      ]
    },
    {
      title: 'Security',
      items: [
        'Open in VS Code or in the terminal does not pass the path through the command line.',
        'The error log (Help ▸ Error Log) masks users and tokens that appear in a URL.'
      ]
    }
  ]
}
