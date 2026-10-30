/**
 * Autofetch (H10): llama `run` cada `minutes` minutos mientras haya un repo abierto.
 * Con 0 no programa nada: ni temporizador ni procesos git. Devuelve la función que lo detiene.
 */
export function scheduleAutoFetch(minutes: number, run: () => void): () => void {
  if (minutes <= 0) return () => {}
  const timer = setInterval(run, minutes * 60_000)
  return () => clearInterval(timer)
}
