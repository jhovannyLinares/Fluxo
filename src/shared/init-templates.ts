/**
 * Plantillas de «Init» (fase 5). GitKraken trae las 127 de github/gitignore y 18 licencias desde la red;
 * Fluxo lleva un subconjunto incluido, así que crear un repo no depende de internet.
 */

export const GITIGNORE_TEMPLATES: Record<string, string> = {
  Go: `# Binarios y pruebas
*.exe
*.exe~
*.dll
*.so
*.dylib
*.test
*.out

# Dependencias vendorizadas
vendor/

# Espacio de trabajo
go.work
`,
  Java: `# Compilados
*.class

# Logs
*.log

# Empaquetados
*.jar
*.war
*.nar
*.ear
*.zip
*.tar.gz
*.rar

# Crashes de la JVM
hs_err_pid*
replay_pid*
`,
  Maven: `target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties
dependency-reduced-pom.xml
buildNumber.properties
.mvn/timing.properties
.mvn/wrapper/maven-wrapper.jar
`,
  Node: `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Dependencias
node_modules/
jspm_packages/

# Cachés
.npm
.eslintcache
.node_repl_history

# Salida de compilación
dist/
build/

# Variables de entorno
.env
.env.*
!.env.example

# Cobertura
coverage/
.nyc_output
`,
  Python: `# Bytecode
__pycache__/
*.py[cod]
*$py.class

# Entornos virtuales
.venv/
venv/
env/
ENV/

# Empaquetado
build/
dist/
*.egg-info/
.eggs/

# Pruebas y cobertura
.pytest_cache/
.coverage
htmlcov/
.tox/

# Variables de entorno
.env
`,
  Rust: `# Salida de compilación
/target/

# Cargo.lock solo se versiona en aplicaciones, no en bibliotecas
# Cargo.lock

# Copias de rustfmt
**/*.rs.bk
`,
  VisualStudio: `# Salida de compilación
[Bb]in/
[Oo]bj/
[Dd]ebug/
[Rr]elease/
x64/
x86/

# Archivos de usuario
*.suo
*.user
*.userosscache
*.sln.docstates
.vs/

# Resultados de pruebas
[Tt]est[Rr]esult*/
*.trx

# Paquetes NuGet
*.nupkg
**/[Pp]ackages/*
`
}

export const GITIGNORE_NAMES = Object.keys(GITIGNORE_TEMPLATES)

type LicenseFn = (year: number, holder: string) => string

const BSD_BODY = (clauses: string[]) => `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

${clauses.join('\n\n')}

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`

const C1 = '1. Redistributions of source code must retain the above copyright notice, this\n   list of conditions and the following disclaimer.'
const C2 = '2. Redistributions in binary form must reproduce the above copyright notice,\n   this list of conditions and the following disclaimer in the documentation\n   and/or other materials provided with the distribution.'
const C3 = '3. Neither the name of the copyright holder nor the names of its\n   contributors may be used to endorse or promote products derived from\n   this software without specific prior written permission.'

export const LICENSE_TEMPLATES: Record<string, LicenseFn> = {
  'Copyright (C) [year] [name]': (y, n) => `Copyright (C) ${y} ${n}\n`,
  'MIT License': (y, n) => `MIT License

Copyright (c) ${y} ${n}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  'ISC License': (y, n) => `ISC License

Copyright (c) ${y}, ${n}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`,
  'BSD 2-clause "Simplified" License': (y, n) => `BSD 2-Clause License

Copyright (c) ${y}, ${n}
All rights reserved.

${BSD_BODY([C1, C2])}`,
  'BSD 3-clause "New" or "Revised" License': (y, n) => `BSD 3-Clause License

Copyright (c) ${y}, ${n}
All rights reserved.

${BSD_BODY([C1, C2, C3])}`,
  'The Unlicense': () => `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
`
}

export const LICENSE_NAMES = Object.keys(LICENSE_TEMPLATES)

/** Nombre de carpeta válido en Windows y en git: sin separadores, sin caracteres reservados, sin `.`/`..`. */
export function checkRepoName(name: string): 'empty' | 'invalid' | null {
  const n = name.trim()
  if (!n) return 'empty'
  if (n === '.' || n === '..' || /[\\/:*?"<>|]/.test(n) || /[. ]$/.test(n) || n.length > 100) return 'invalid'
  return null
}
