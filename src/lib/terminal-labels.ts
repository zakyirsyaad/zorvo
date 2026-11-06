/** A workspace terminal's name: its shell, and its number from the second tab on ("zsh", "zsh 2"). */
export function tabLabel(shell: string, number: number): string {
  return number > 1 ? `${shell} ${number}` : shell;
}
